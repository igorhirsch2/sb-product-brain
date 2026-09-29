// @ts-nocheck
import type { SupabaseClient } from '@supabase/supabase-js'
import { norm, numberValue, parseDimensions, uniq, type AnyRow } from './utils'

export type ParseContext = {
  supabase: SupabaseClient
  brand: AnyRow
  document: AnyRow
  jobId: string
  products: AnyRow[]
  aiProfile?: AnyRow | null
}

type Matrix = any[][]

function compositeHeaders(matrix:Matrix,start:number,end:number){
  const width=Math.max(...matrix.slice(start,end+1).map(r=>r?.length||0),0)
  const headers:string[]=[]
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
  const limit=Math.min(60,matrix.length)
  for(let end=0;end<limit;end++){
    for(let depth=1;depth<=4;depth++){
      const start=Math.max(0,end-depth+1), headers=compositeHeaders(matrix,start,end), cells=headers.map(norm)
      const find=(re:RegExp)=>cells.findIndex(c=>re.test(c))
      const model=find(/(^| )produtos?( |$)|(^| )modelo( |$)/)
      const description=find(/descricao|descrição/)
      const code=find(/codigo|código|referencia|referência|ref\b/)
      const dimension=find(/medida|dimens/)
      const width=find(/largura|\blarg\b|\bl\b/)
      const depth=find(/profundidade|comprimento|\bcomp\b|\bp\b/)
      const height=find(/altura|\balt\b|\ba\b/)
      let score=0
      if(model>=0)score+=6
      if(description>=0)score+=6
      if(code>=0)score+=5
      if(dimension>=0)score+=3
      score+=cells.filter(c=>/preco|preço|valor|varejo|legenda|grupo|tecido|couro|categoria/.test(c)).length*2
      if((model<0&&description<0)||code<0)continue
      if(!best||score>best.score)best={start,end,headers,cells,score,map:{model,description,code,dimension,width,depth,height}}
    }
  }
  if(!best)return null

  const excluded=new Set(Object.values(best.map).filter((x:any)=>x>=0) as number[])
  const explicit:any[]=[]
  best.cells.forEach((h:string,i:number)=>{
    if(excluded.has(i))return
    if(/preco|preço|valor|varejo|legenda|grupo\s*[a-z0-9]|tecido\s*[a-z0-9]|couro\s*[a-z0-9]|categoria\s*[a-z0-9]/.test(h)){
      explicit.push({index:i,name:best.headers[i]||`Valor ${i+1}`,group:best.headers[i]||`Grupo ${i+1}`})
    }
  })
  if(learned?.price_headers?.length){
    const known=(learned.price_headers as string[]).map(norm)
    best.cells.forEach((h:string,i:number)=>{
      if(excluded.has(i)||explicit.some(x=>x.index===i))return
      if(known.some((k:string)=>h.includes(k)||k.includes(h)))explicit.push({index:i,name:best.headers[i],group:best.headers[i]})
    })
  }

  const sampleRows=matrix.slice(best.end+1,Math.min(matrix.length,best.end+180))
  const stats:any[]=[]
  const width=Math.max(...sampleRows.map(r=>r?.length||0),0)
  for(let c=0;c<width;c++){
    if(excluded.has(c))continue
    const vals=sampleRows.map(r=>numberValue(r?.[c])).filter((x:any)=>x!=null&&x>50) as number[]
    if(vals.length<4)continue
    vals.sort((a,b)=>a-b)
    stats.push({index:c,count:vals.length,median:vals[Math.floor(vals.length/2)]})
  }
  const dense=stats.filter(s=>s.count>=Math.max(4,Math.floor(sampleRows.length*.08))).sort((a,b)=>a.index-b.index)
  const clusters:any[][]=[]
  for(const s of dense){
    const last=clusters[clusters.length-1]
    if(!last||s.index-last[last.length-1].index>2)clusters.push([s]);else last.push(s)
  }
  const useful=clusters.filter(c=>c.length>=2)
  useful.sort((a,b)=>{
    const am=a.reduce((t,x)=>t+x.median,0)/a.length,bm=b.reduce((t,x)=>t+x.median,0)/b.length
    return bm-am
  })
  let priceCols=explicit
  if(priceCols.length<2&&useful.length){
    const chosen=useful[0].slice(0,8)
    const ordered=[...chosen].sort((a,b)=>a.median-b.median)
    priceCols=chosen.map(s=>{
      const rank=ordered.findIndex(x=>x.index===s.index)
      const label=best.headers[s.index]?.trim()
      return {index:s.index,name:label||`Grupo ${String.fromCharCode(65+rank)}`,group:label&&/grupo|legenda|tecido|couro|categoria/i.test(label)?label:`Grupo ${String.fromCharCode(65+rank)}`}
    })
  }
  if(priceCols.length>8)priceCols=priceCols.slice(0,8)
  return {...best,priceCols}
}

function safeText(v:any){return String(v??'').replace(/\s+/g,' ').trim()}
function isLikelyCode(v:string){return /^\d{3,4}[.\-/]\d{3,8}$/.test(v)||/^[A-Z0-9]{2,}[-.][A-Z0-9.-]{2,}$/i.test(v)}

export async function parseSupplierWorkbook(file:Blob,ctx:ParseContext){
  const {supabase,brand,document,jobId,products,aiProfile}=ctx

  if(typeof window!=='undefined'){
    const {data:{session}}=await supabase.auth.getSession()
    if(!session)throw new Error('Sua sessão expirou. Entre novamente.')
    const response=await fetch('/api/process-document',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({documentId:document.id,jobId})})
    const body=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(body.error||'Falha ao processar o arquivo no servidor.')
    const total=Number(body.summary?.prices_detected||0),matched=Number(body.summary?.matched||0)
    const rows=Array.from({length:total},(_,i)=>({product_id:i<matched?'matched':null}))
    return {rows,proposals:Array.from({length:Number(body.proposals||0)}),summary:body.summary||{}}
  }

  const XLSX=await import('xlsx')
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false})
  const brandProducts=products.filter(p=>p.brand_id===brand.id)
  const {data:codes}=await supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id)
  const extracted:any[]=[]
  const mappings:any[]=[]

  for(const sheetName of wb.SheetNames){
    const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,raw:false,defval:''}) as Matrix
    if(!matrix.length)continue
    const h=detectStructure(matrix,aiProfile?.learned_mapping)
    if(!h||!h.priceCols.length)continue
    mappings.push({sheet:sheetName,header_rows:[h.start,h.end],headers:h.headers,columns:h.map,price_columns:h.priceCols})

    let currentModel='',lastDescription=''
    for(let ri=h.end+1;ri<matrix.length;ri++){
      const row=matrix[ri]||[]
      const model=h.map.model>=0?safeText(row[h.map.model]):''
      const description=h.map.description>=0?safeText(row[h.map.description]):''
      const code=h.map.code>=0?safeText(row[h.map.code]):''
      if(model&&!code&&!description){currentModel=model;continue}
      if(model&&model.length<80&&!isLikelyCode(model))currentModel=model
      if(description)lastDescription=description
      if(!code||!isLikelyCode(code))continue

      const productName=currentModel||description||lastDescription||code
      const variantLabel=description||safeText(row[h.map.model])||code
      let d:any={}
      if(h.map.dimension>=0)d=parseDimensions(row[h.map.dimension])
      if(!d.dimension_label){
        const parts=[h.map.width>=0?row[h.map.width]:'',h.map.depth>=0?row[h.map.depth]:'',h.map.height>=0?row[h.map.height]:''].filter(v=>safeText(v))
        if(parts.length>=2){
          const vals=parts.map(numberValue),mm=(x:any)=>x==null?null:Math.round(Number(x)<1000?Number(x)*10:Number(x))
          d={dimension_label:parts.map(safeText).join(' x '),width_mm:mm(vals[0]),depth_mm:mm(vals[1]),height_mm:mm(vals[2])}
        }
      }

      const byCode=(codes||[]).find((x:any)=>norm(x.product_code)===norm(code))
      const byManufacturer=brandProducts.find(p=>norm(p.manufacturer_code)===norm(code))
      const byModel=brandProducts.find(p=>norm(p.name)===norm(productName))
      const productId=byCode?.product_id||byManufacturer?.id||byModel?.id||null

      for(const pc of h.priceCols){
        const price=numberValue(row[pc.index])
        if(price==null||price<=50)continue
        extracted.push({job_id:jobId,row_index:ri+1,variant_index:pc.index,sheet_name:sheetName,source_locator:{sheet:sheetName,row:ri+1,column:pc.index+1,header:pc.name,variant_label:variantLabel},raw_payload:{row,model:productName,variant_label:variantLabel},product_name_raw:productName,supplier_product_code:code,product_id:productId,dimension_label:d.dimension_label||null,width_mm:d.width_mm||null,depth_mm:d.depth_mm||null,height_mm:d.height_mm||null,pricing_group:pc.group||pc.name,finish_group:null,cost_price:document.price_basis==='cost'?price:null,price_value:price,price_basis:document.price_basis||null,currency:'BRL',confidence:Math.min(.98,(productId?.75:.58)+.12+.08+(d.dimension_label?.05:0)),status:'review',notes:variantLabel||null})
      }
    }
  }

  if(!extracted.length)throw new Error('Astra não encontrou linhas de produto/preço confiáveis. O arquivo foi preservado para ajuste do perfil de leitura.')
  for(let i=0;i<extracted.length;i+=300){const {error}=await supabase.from('extraction_rows').insert(extracted.slice(i,i+300));if(error)throw error}
  const grouped=new Map<string,any[]>()
  for(const r of extracted){const key=norm(r.product_name_raw)||norm(r.supplier_product_code);if(!key)continue;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key)!.push(r)}
  const proposals:any[]=[]
  for(const rows of grouped.values()){
    const first=rows[0]
    const target=rows.map(x=>x.product_id).find(Boolean)||brandProducts.find(p=>norm(p.name)===norm(first.product_name_raw))?.id||null
    const supplierCodes=uniq(rows.map(x=>x.supplier_product_code).filter(Boolean)),variants=uniq(rows.map(x=>x.source_locator?.variant_label).filter(Boolean))
    proposals.push({job_id:jobId,source_document_id:document.id,brand_id:brand.id,entity_type:'product',action:target?'update':'create',target_id:target,proposed_data:{name:first.product_name_raw||first.supplier_product_code||'Produto sem nome',manufacturer_code:supplierCodes[0]||null,supplier_codes:supplierCodes,variant_labels:variants,dimensions:uniq(rows.map(x=>x.dimension_label).filter(Boolean)),pricing_groups:uniq(rows.map(x=>x.pricing_group).filter(Boolean)),price_count:rows.length,price_basis:document.price_basis},current_data:target?brandProducts.find(p=>p.id===target)||{}:{},source_locator:{sheet:first.sheet_name,codes:supplierCodes,name:first.product_name_raw},dependencies:{},confidence:Math.max(...rows.map(x=>Number(x.confidence)||0)),status:'pending'})
  }
  for(let i=0;i<proposals.length;i+=200){const {error}=await supabase.from('change_proposals').insert(proposals.slice(i,i+200));if(error)throw error}
  return {rows:extracted,proposals,summary:{sheets:wb.SheetNames.length,mappings,products_detected:grouped.size,prices_detected:extracted.length,matched:extracted.filter(x=>x.product_id).length}}
}

export async function learnSupplierProfile(supabase:SupabaseClient,brandId:string,docType:string,summary:any,existing?:AnyRow|null){
  if(typeof window!=='undefined')return
  const mapping={...(existing?.learned_mapping||{}),last_mappings:summary.mappings,price_headers:uniq(summary.mappings.flatMap((m:any)=>m.price_columns?.map((p:any)=>p.name)||[]))}
  if(existing) await supabase.from('supplier_ai_profiles').update({version:(existing.version||1)+1,learned_mapping:mapping,successful_runs:(existing.successful_runs||0)+1,confidence:Math.min(.95,Number(existing.confidence||.55)+.04),last_used_at:new Date().toISOString()}).eq('id',existing.id)
  else await supabase.from('supplier_ai_profiles').insert({brand_id:brandId,document_type:docType,profile_name:`Astra · ${docType}`,version:1,fingerprints:{},learned_mapping:mapping,learned_rules:{},approved_examples:[],confidence:.55,successful_runs:1,is_active:true,last_used_at:new Date().toISOString()})
}
