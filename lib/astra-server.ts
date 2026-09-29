// @ts-nocheck
import * as XLSX from 'xlsx'
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
  for(let end=0;end<limit;end++)for(let depth=1;depth<=5;depth++){
    const start=Math.max(0,end-depth+1),headers=compositeHeaders(matrix,start,end),cells=headers.map(norm)
    const find=(re:RegExp)=>cells.findIndex(c=>re.test(c))
    const model=find(/(^| )produtos?( |$)|(^| )modelo( |$)/),description=find(/descricao/),code=find(/codigo|referencia|ref\b/)
    const dimension=find(/medida|dimens/),width=find(/largura|\blarg\b|\bl\b/),depth=find(/profundidade|comprimento|\bcomp\b|\bp\b/),height=find(/altura|\balt\b|\ba\b/)
    let score=(model>=0?6:0)+(description>=0?6:0)+(code>=0?5:0)+(dimension>=0?3:0)+cells.filter(c=>/preco|valor|varejo|legenda|grupo|tecido|couro|categoria/.test(c)).length*2
    if((model<0&&description<0)||code<0)continue
    if(!best||score>best.score)best={start,end,headers,cells,score,map:{model,description,code,dimension,width,depth,height}}
  }
  if(!best)return null
  const excluded=new Set(Object.values(best.map).filter((x:any)=>x>=0) as number[]),explicit:any[]=[]
  best.cells.forEach((h:string,i:number)=>{
    if(excluded.has(i))return
    if(/preco|valor|varejo|legenda|grupo\s*[a-z0-9]|tecido\s*[a-z0-9]|couro\s*[a-z0-9]|categoria\s*[a-z0-9]/.test(h))explicit.push({index:i,name:best.headers[i]||`Valor ${i+1}`,group:best.headers[i]||`Grupo ${i+1}`})
  })
  if(learned?.price_headers?.length){
    const known=(learned.price_headers as string[]).map(norm)
    best.cells.forEach((h:string,i:number)=>{if(!excluded.has(i)&&!explicit.some(x=>x.index===i)&&known.some((k:string)=>h.includes(k)||k.includes(h)))explicit.push({index:i,name:best.headers[i],group:best.headers[i]})})
  }
  const sample=matrix.slice(best.end+1,Math.min(matrix.length,best.end+220)),stats:any[]=[]
  const width=Math.max(...sample.map(r=>r?.length||0),0)
  for(let c=0;c<width;c++){
    if(excluded.has(c))continue
    const vals=sample.map(r=>numberValue(r?.[c])).filter((x:any)=>x!=null&&x>50) as number[]
    if(vals.length<5)continue
    vals.sort((a,b)=>a-b);stats.push({index:c,count:vals.length,median:vals[Math.floor(vals.length/2)]})
  }
  const dense=stats.filter(s=>s.count>=Math.max(5,Math.floor(sample.length*.06))).sort((a,b)=>a.index-b.index),clusters:any[][]=[]
  for(const s of dense){const last=clusters[clusters.length-1];if(!last||s.index-last[last.length-1].index>2)clusters.push([s]);else last.push(s)}
  const useful=clusters.filter(c=>c.length>=2).sort((a,b)=>b.reduce((t,x)=>t+x.median,0)/b.length-a.reduce((t,x)=>t+x.median,0)/a.length)
  let priceCols=explicit
  if(priceCols.length<3&&useful.length){
    const chosen=useful[0].slice(0,8),ordered=[...chosen].sort((a,b)=>a.median-b.median)
    priceCols=chosen.map(s=>{const rank=ordered.findIndex(x=>x.index===s.index),label=best.headers[s.index]?.trim();return {index:s.index,name:label||`Grupo ${String.fromCharCode(65+rank)}`,group:label&&/grupo|legenda|tecido|couro|categoria/i.test(label)?label:`Grupo ${String.fromCharCode(65+rank)}`}})
  }
  if(priceCols.length>8)priceCols=priceCols.slice(0,8)
  return {...best,priceCols}
}

const safeText=(v:any)=>String(v??'').replace(/\s+/g,' ').trim()
const isCode=(v:string)=>/^\d{3,4}[.\-/]\d{3,8}$/.test(v)||/^[A-Z0-9]{2,}[-.][A-Z0-9.-]{2,}$/i.test(v)

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

async function fallbackFromPreviousExtraction(ctx:ParseContext){
  const {supabase,brand,document,jobId,products}=ctx
  const {data:jobs}=await supabase.from('ingestion_jobs').select('id,status,total_rows,created_at').eq('source_document_id',document.id).neq('id',jobId).gt('total_rows',0).order('created_at',{ascending:false}).limit(1)
  const oldJob=jobs?.[0];if(!oldJob)return null
  const {data:oldRows,error}=await supabase.from('extraction_rows').select('*').eq('job_id',oldJob.id).order('sheet_name').order('row_index').limit(10000)
  if(error||!oldRows?.length)return null
  const brandProducts=products.filter(p=>p.brand_id===brand.id),{data:codes}=await supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id)
  const extracted:any[]=[],modelBySheet=new Map<string,string>()
  const candidateCols=['col_11','col_12','col_13','col_14','col_15','col_17']
  for(const src of oldRows){
    const raw=src.raw_payload||{},sheet=src.sheet_name||'Planilha',heading=safeText(raw.PRODUTOS)
    if(heading)modelBySheet.set(sheet,heading)
    const code=safeText(raw['CÓDIGO']||src.supplier_product_code),desc=safeText(raw['DESCRIÇÃO']||src.product_name_raw)
    if(!code||!isCode(code))continue
    const productName=modelBySheet.get(sheet)||desc||code,dimension=safeText(raw['DIMENSÕES']||src.dimension_label),d=parseDimensions(dimension)
    const byCode=(codes||[]).find((x:any)=>norm(x.product_code)===norm(code)),byManufacturer=brandProducts.find(p=>norm(p.manufacturer_code)===norm(code)),byModel=brandProducts.find(p=>norm(p.name)===norm(productName)),productId=byCode?.product_id||byManufacturer?.id||byModel?.id||null
    candidateCols.forEach((col,i)=>{const price=numberValue(raw[col]);if(price==null||price<=50)return;extracted.push({job_id:jobId,row_index:src.row_index,variant_index:i,sheet_name:sheet,source_locator:{sheet,row:src.row_index,legacy_column:col,variant_label:desc},raw_payload:{legacy_source_id:src.id,model:productName,variant_label:desc},product_name_raw:productName,supplier_product_code:code,product_id:productId,dimension_label:dimension||null,width_mm:d.width_mm||null,depth_mm:d.depth_mm||null,height_mm:d.height_mm||null,pricing_group:`Grupo ${String.fromCharCode(65+i)}`,finish_group:null,cost_price:document.price_basis==='cost'?price:null,price_value:price,price_basis:document.price_basis||null,currency:'BRL',confidence:productId?.92:.76,status:'review',notes:desc||null})})
  }
  if(!extracted.length)return null
  return {extracted,summaryExtra:{fallback:'historical_extraction',source_job_id:oldJob.id}}
}

export async function parseSupplierWorkbook(file:Blob,ctx:ParseContext){
  const {supabase,brand,document,jobId,products,aiProfile}=ctx
  const brandProducts=products.filter(p=>p.brand_id===brand.id),{data:codes}=await supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id)
  let extracted:any[]=[],mappings:any[]=[],sheetCount=0,summaryExtra:any={}
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});sheetCount=wb.SheetNames.length
    for(const sheetName of wb.SheetNames){
      const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,raw:false,defval:''}) as Matrix
      if(!matrix.length)continue
      const h=detectStructure(matrix,aiProfile?.learned_mapping);if(!h||!h.priceCols.length)continue
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
        if(!dims.dimension_label){const parts=[h.map.width>=0?row[h.map.width]:'',h.map.depth>=0?row[h.map.depth]:'',h.map.height>=0?row[h.map.height]:''].filter(v=>safeText(v));if(parts.length>=2){const vals=parts.map(numberValue),mm=(x:any)=>x==null?null:Math.round(Number(x)<1000?Number(x)*10:Number(x));dims={dimension_label:parts.map(safeText).join(' x '),width_mm:mm(vals[0]),depth_mm:mm(vals[1]),height_mm:mm(vals[2])}}}
        const byCode=(codes||[]).find((x:any)=>norm(x.product_code)===norm(code)),byManufacturer=brandProducts.find(p=>norm(p.manufacturer_code)===norm(code)),byModel=brandProducts.find(p=>norm(p.name)===norm(productName)),productId=byCode?.product_id||byManufacturer?.id||byModel?.id||null
        for(const pc of h.priceCols){const price=numberValue(row[pc.index]);if(price==null||price<=50)continue;extracted.push({job_id:jobId,row_index:ri+1,variant_index:pc.index,sheet_name:sheetName,source_locator:{sheet:sheetName,row:ri+1,column:pc.index+1,header:pc.name,variant_label:variantLabel},raw_payload:{row,model:productName,variant_label:variantLabel},product_name_raw:productName,supplier_product_code:code,product_id:productId,dimension_label:dims.dimension_label||null,width_mm:dims.width_mm||null,depth_mm:dims.depth_mm||null,height_mm:dims.height_mm||null,pricing_group:pc.group||pc.name,finish_group:null,cost_price:document.price_basis==='cost'?price:null,price_value:price,price_basis:document.price_basis||null,currency:'BRL',confidence:Math.min(.98,(productId?.75:.58)+.2+(dims.dimension_label?.05:0)),status:'review',notes:variantLabel||null})}
      }
    }
  }catch(err){summaryExtra.xlsx_error=err instanceof Error?err.message:String(err)}

  if(!extracted.length){const fallback=await fallbackFromPreviousExtraction(ctx);if(fallback){extracted=fallback.extracted;summaryExtra={...summaryExtra,...fallback.summaryExtra}}}
  if(!extracted.length)throw new Error('Astra não encontrou linhas de produto/preço confiáveis. O arquivo foi preservado para ajuste do perfil de leitura.')
  for(let i=0;i<extracted.length;i+=300){const {error}=await supabase.from('extraction_rows').insert(extracted.slice(i,i+300));if(error)throw error}
  const {grouped,proposals}=groupAndPropose(extracted,brandProducts,document,brand,jobId)
  for(let i=0;i<proposals.length;i+=200){const {error}=await supabase.from('change_proposals').insert(proposals.slice(i,i+200));if(error)throw error}
  return {rows:extracted,proposals,summary:{sheets:sheetCount,mappings,products_detected:grouped.size,prices_detected:extracted.length,matched:extracted.filter(x=>x.product_id).length,...summaryExtra}}
}

export async function learnSupplierProfile(supabase:SupabaseClient,brandId:string,docType:string,summary:any,existing?:AnyRow|null){
  const mapping={...(existing?.learned_mapping||{}),last_mappings:summary.mappings||[],price_headers:uniq((summary.mappings||[]).flatMap((m:any)=>m.price_columns?.map((p:any)=>p.name)||[]))}
  if(existing)await supabase.from('supplier_ai_profiles').update({version:(existing.version||1)+1,learned_mapping:mapping,successful_runs:(existing.successful_runs||0)+1,confidence:Math.min(.95,Number(existing.confidence||.55)+.04),last_used_at:new Date().toISOString()}).eq('id',existing.id)
  else await supabase.from('supplier_ai_profiles').insert({brand_id:brandId,document_type:docType,profile_name:`Astra · ${docType}`,version:1,fingerprints:{},learned_mapping:mapping,learned_rules:{},approved_examples:[],confidence:.55,successful_runs:1,is_active:true,last_used_at:new Date().toISOString()})
}
