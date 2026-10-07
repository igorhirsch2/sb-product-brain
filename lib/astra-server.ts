// @ts-nocheck
import * as XLSX from 'xlsx'
import { queryAll } from './queryAll'
import type { SupabaseClient } from '@supabase/supabase-js'
import { norm, numberValue, parseDimensions, uniq, type AnyRow } from './utils'

export type ParseContext={supabase:SupabaseClient;brand:AnyRow;document:AnyRow;jobId:string;products:AnyRow[];aiProfile?:AnyRow|null}
type Matrix=any[][]

function compositeHeaders(matrix:Matrix,start:number,end:number){
  const width=Math.max(...matrix.slice(start,end+1).map(r=>r?.length||0),0),headers:string[]=[]
  for(let c=0;c<width;c++){
    const parts:string[]=[]
    for(let r=start;r<=end;r++){
      const v=String(matrix[r]?.[c]??'').trim()
      if(v&&!parts.some(x=>norm(x)===norm(v)))parts.push(v)
    }
    headers[c]=parts.join(' · ')
  }
  return headers
}

function detectStructure(matrix:Matrix,learned:any){
  let best:any=null
  const limit=Math.min(80,matrix.length)
  for(let end=0;end<limit;end++)for(let headerDepth=1;headerDepth<=5;headerDepth++){
    const start=Math.max(0,end-headerDepth+1)
    // A header candidate must not swallow a row containing both a code and a price.
    const headers=compositeHeaders(matrix,start,end),cells=headers.map(norm)
    const find=(re:RegExp)=>cells.findIndex(c=>re.test(c))
    const axis=(re:RegExp)=>cells.findIndex(c=>!/(preco|valor|varejo|legenda|grupo|tecido|couro)/.test(c)&&re.test(c))
    const model=find(/(^| )produtos?( |$)|(^| )modelo( |$)/),description=find(/descricao/),code=find(/codigo|referencia|ref\b/)
    const dimension=find(/medida|dimens/),width=axis(/largura|\blarg\b|\bl\b/),depth=axis(/profundidade|comprimento|\bcomp\b|\bp\b/),height=axis(/altura|\balt\b|\ba\b/)
    let score=(model>=0?6:0)+(description>=0?6:0)+(code>=0?5:0)+(dimension>=0?3:0)+cells.filter(c=>/preco|valor|varejo|legenda|grupo|tecido|couro|categoria/.test(c)).length*2
    if(end>start)score+=(matrix[end]||[]).filter(v=>/^[A-Z]$|^(grupo|legenda|tecido|couro)\s+[A-Z0-9]+$/i.test(safeText(v))).length
    if((model<0&&description<0)||code<0)continue
    if(matrix.slice(start,end+1).some(row=>isCode(safeText(row?.[code]))))continue
    if(!best||score>best.score||(score===best.score&&end<best.end))best={start,end,headers,cells,score,map:{model,description,code,dimension,width,depth,height}}
  }
  if(!best)return null
  const excluded=new Set(Object.values(best.map).filter((x:any)=>x>=0) as number[]),explicit:any[]=[]
  best.cells.forEach((h:string,i:number)=>{
    if(excluded.has(i)||/desconto|percent|consumo|peso|volume|markup/.test(h))return
    if(/preco|valor|varejo|legenda|grupo\s*[a-z0-9]|tecido\s*[a-z0-9]|couro\s*[a-z0-9]|categoria\s*[a-z0-9]/.test(h))explicit.push({index:i,name:best.headers[i]||`Valor ${i+1}`,group:best.headers[i]||`Grupo ${i+1}`})
  })
  if(learned?.price_headers?.length){
    const known=(learned.price_headers as string[]).map(norm)
    best.cells.forEach((h:string,i:number)=>{if(!excluded.has(i)&&!explicit.some(x=>x.index===i)&&h&&known.some((k:string)=>h===k))explicit.push({index:i,name:best.headers[i],group:best.headers[i]})})
  }
  // Only named price columns are accepted. Numeric density is not evidence of price.
  const priceCols=explicit
  return {...best,priceCols}
}

const safeText=(v:any)=>String(v??'').replace(/\s+/g,' ').trim()
const isCode=(v:string)=>/^[A-Z0-9][A-Z0-9._\-/]*$/i.test(v)&&/\d/.test(v)&&!/^\d+[,.]\d{2}$/.test(v)

function groupAndPropose(extracted:any[],brandProducts:any[],document:any,brand:any,jobId:string){
  const grouped=new Map<string,any[]>()
  for(const r of extracted){const key=norm(r.product_name_raw)||norm(r.supplier_product_code);if(!key)continue;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key)!.push(r)}
  const proposals:any[]=[]
  for(const rows of grouped.values()){
    const first=rows[0],target=rows.map(x=>x.product_id).find(Boolean)||brandProducts.find(p=>norm(p.name)===norm(first.product_name_raw))?.id||null
    const supplierCodes=uniq(rows.map(x=>x.supplier_product_code).filter(Boolean)),variants=uniq(rows.map(x=>x.source_locator?.variant_label).filter(Boolean))
    proposals.push({job_id:jobId,source_document_id:document.id,brand_id:brand.id,entity_type:'product',action:target?'update':'create',target_id:target,proposed_data:{name:first.product_name_raw||supplierCodes[0]||'Produto sem nome',manufacturer_code:supplierCodes[0]||null,supplier_codes:supplierCodes,variant_labels:variants,dimensions:uniq(rows.map(x=>x.dimension_label).filter(Boolean)),pricing_groups:uniq(rows.map(x=>x.pricing_group).filter(Boolean)),price_count:rows.length,price_basis:document.price_basis},current_data:target?brandProducts.find(p=>p.id===target)||{}:{},source_locator:{sheet:first.sheet_name,codes:supplierCodes,name:first.product_name_raw},dependencies:{},confidence:Math.max(...rows.map(x=>Number(x.confidence)||0)),status:'pending'})
  }
  return {grouped,proposals}
}

export async function parseSupplierWorkbook(file:Blob,ctx:ParseContext){
  const {supabase,brand,document,jobId,products,aiProfile}=ctx
  const brandProducts=products.filter(p=>p.brand_id===brand.id)
  const codes=await queryAll((from,to)=>supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id).order('product_code').range(from,to))
  let extracted:any[]=[],mappings:any[]=[],sheetCount=0,summaryExtra:any={skipped_sheets:[],warnings:[]}
  try{
    const bytes=new Uint8Array(await file.arrayBuffer())
    const binary=(bytes[0]===0x50&&bytes[1]===0x4b)||(bytes[0]===0xd0&&bytes[1]===0xcf)
    let text=''
    if(!binary){try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{text=new TextDecoder('windows-1252').decode(bytes)}}
    const wb=binary?XLSX.read(bytes,{type:'array',cellDates:false}):XLSX.read(text,{type:'string',raw:true,cellDates:false})
    sheetCount=wb.SheetNames.length
    for(const sheetName of wb.SheetNames){
      const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,raw:false,defval:''}) as Matrix
      if(!matrix.length)continue
      // Preserve merged group headings without copying values into unpriced cells.
      for(const merge of wb.Sheets[sheetName]['!merges']||[]){
        if(merge.s.r===merge.e.r&&merge.s.r<80){
          const value=matrix[merge.s.r]?.[merge.s.c]
          if(typeof value==='string'&&/preco|valor|varejo|legenda|grupo|tecido|couro/.test(norm(value)))
            for(let col=merge.s.c+1;col<=merge.e.c;col++)if(!matrix[merge.s.r][col])matrix[merge.s.r][col]=value
        }
      }
      const h=detectStructure(matrix,aiProfile?.learned_mapping);if(!h||!h.priceCols.length){summaryExtra.skipped_sheets.push(sheetName);continue}
      mappings.push({sheet:sheetName,header_rows:[h.start,h.end],headers:h.headers,columns:h.map,price_columns:h.priceCols})
      let currentModel='',lastDescription=''
      for(let ri=h.end+1;ri<matrix.length;ri++){
        const row=matrix[ri]||[],model=h.map.model>=0?safeText(row[h.map.model]):'',description=h.map.description>=0?safeText(row[h.map.description]):'',code=h.map.code>=0?safeText(row[h.map.code]):''
        if(model&&!code&&!description){currentModel=model;continue}
        if(model&&model.length<80&&!isCode(model))currentModel=model
        if(description)lastDescription=description
        if(!code||!isCode(code))continue
        const productName=currentModel||description||lastDescription||code,variantLabel=description||model||code
        let dims:any=h.map.dimension>=0?parseDimensions(row[h.map.dimension]):{}
        if(!dims.dimension_label){const parts=[h.map.width>=0?row[h.map.width]:'',h.map.depth>=0?row[h.map.depth]:'',h.map.height>=0?row[h.map.height]:''].filter(v=>safeText(v));if(parts.length>=2){const axis=(index:number)=>index<0?null:(parseDimensions(`${safeText(row[index])} ${h.headers[index]?.match(/\b(mm|cm|m)\b/i)?.[1]||''}`) as any).width_mm??null;dims={dimension_label:parts.map(safeText).join(' x '),width_mm:axis(h.map.width),depth_mm:axis(h.map.depth),height_mm:axis(h.map.height)}}}
        const byCode=(codes||[]).find((x:any)=>String(x.product_code).trim()===code),byManufacturer=brandProducts.find(p=>String(p.manufacturer_code||'').trim()===code),byModel=brandProducts.find(p=>norm(p.name)===norm(productName)),productId=byCode?.product_id||byManufacturer?.id||byModel?.id||null
        for(const pc of h.priceCols){const price=numberValue(row[pc.index]);if(price==null||price<=0)continue;extracted.push({job_id:jobId,row_index:ri+1,variant_index:pc.index,sheet_name:sheetName,source_locator:{sheet:sheetName,row:ri+1,column:pc.index+1,header:pc.name,variant_label:variantLabel},raw_payload:{row,model:productName,variant_label:variantLabel},product_name_raw:productName,supplier_product_code:code,product_id:productId,dimension_label:dims.dimension_label||null,width_mm:dims.width_mm||null,depth_mm:dims.depth_mm||null,height_mm:dims.height_mm||null,pricing_group:pc.group||pc.name,finish_group:null,cost_price:document.price_basis==='cost'?price:null,price_value:price,price_basis:document.price_basis||null,currency:'BRL',confidence:Math.min(.98,(productId?.75:.58)+.2+(dims.dimension_label?.05:0)),status:'needs_review',notes:variantLabel||null})}
      }
    }
  }catch(err){throw new Error(`Não foi possível ler o arquivo: ${err instanceof Error?err.message:String(err)}`)}

  if(!extracted.length)throw new Error('Astra não encontrou linhas de produto/preço confiáveis. O arquivo foi preservado para ajuste do perfil de leitura.')
  if(summaryExtra.skipped_sheets.length)summaryExtra.warnings.push(`Abas sem cabeçalho de preço reconhecido: ${summaryExtra.skipped_sheets.join(', ')}. Confira o original.`)
  for(let i=0;i<extracted.length;i+=300){const {error}=await supabase.from('extraction_rows').insert(extracted.slice(i,i+300));if(error)throw error}
  const {grouped,proposals}=groupAndPropose(extracted,brandProducts,document,brand,jobId)
  for(let i=0;i<proposals.length;i+=200){const {error}=await supabase.from('change_proposals').insert(proposals.slice(i,i+200));if(error)throw error}
  return {rows:extracted,proposals,summary:{sheets:sheetCount,mappings,products_detected:grouped.size,prices_detected:extracted.length,matched:extracted.filter(x=>x.product_id).length,...summaryExtra}}
}

export async function learnSupplierProfile(supabase:SupabaseClient,brandId:string,docType:string,summary:any,existing?:AnyRow|null){
  const mapping={...(existing?.learned_mapping||{}),last_mappings:summary.mappings||[],price_headers:uniq((summary.mappings||[]).flatMap((m:any)=>m.price_columns?.map((p:any)=>p.name)||[]))}
  const result=existing?await supabase.from('supplier_ai_profiles').update({version:(existing.version||1)+1,learned_mapping:mapping,successful_runs:(existing.successful_runs||0)+1,confidence:Math.min(.95,Number(existing.confidence||.55)+.04),last_used_at:new Date().toISOString()}).eq('id',existing.id)
  :await supabase.from('supplier_ai_profiles').insert({brand_id:brandId,document_type:docType,profile_name:`Astra · ${docType}`,version:1,fingerprints:{},learned_mapping:mapping,learned_rules:{},approved_examples:[],confidence:.55,successful_runs:1,is_active:true,last_used_at:new Date().toISOString()})
  if(result.error)throw result.error
}
