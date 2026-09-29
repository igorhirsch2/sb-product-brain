// @ts-nocheck
import type { SupabaseClient } from '@supabase/supabase-js'
import { norm, numberValue, parseDimensions, uniq, type AnyRow } from './utils'

type RecoveryContext={
  supabase:SupabaseClient
  brand:AnyRow
  document:AnyRow
  jobId:string
  products:AnyRow[]
}

const PRICE_COLUMNS=[
  {key:'col_11',label:'Legenda A'},
  {key:'col_12',label:'Legenda B'},
  {key:'col_13',label:'Legenda C'},
  {key:'col_14',label:'Legenda D'},
  {key:'col_15',label:'Legenda E'},
  {key:'col_17',label:'Legenda F'}
]

const safeText=(v:any)=>String(v??'').replace(/\s+/g,' ').trim()
const isCode=(v:string)=>/^\d{3,4}[.\-/]\d{3,8}$/.test(v)||/^[A-Z0-9]{2,}[-.][A-Z0-9.-]{2,}$/i.test(v)

function titleCase(v:string){
  const s=safeText(v)
  if(!s)return ''
  return s.toLocaleLowerCase('pt-BR').split(' ').map(w=>w?`${w.charAt(0).toLocaleUpperCase('pt-BR')}${w.slice(1)}`:'').join(' ')
}

function categoryFrom(desc:string,list:string){
  const source=`${desc} ${list}`.trim()
  const m=source.match(/\b(poltrona|sof[aá]|pufe|mesa|cadeira|chaise|banqueta|banco|cama|recami[eê]|m[oó]dulo)\b/i)
  if(!m)return ''
  const n=norm(m[1])
  if(n==='sofa')return 'Sofá'
  if(n==='modulo')return 'Módulo'
  if(n==='recamie')return 'Recamiê'
  return titleCase(m[1])
}

function modelFromList(list:string){
  const cleaned=safeText(list).replace(/[–—]/g,'-')
  if(!cleaned)return ''
  const tokens=cleaned.split(/\s+/)
  const categoryIndex=tokens.findIndex(t=>/^(poltrona|sofa|sofá|pufe|mesa|cadeira|chaise|banqueta|banco|cama|recamier|recamiê)$/i.test(t))
  const start=categoryIndex>=0?categoryIndex+1:0
  const model:string[]=[]
  for(let i=start;i<tokens.length;i++){
    const token=tokens[i].replace(/^[-]+|[-]+$/g,'')
    if(!token)continue
    if(/^M\d+(?:[-/]\d+)?$/i.test(token)||/^\d{2,4}x\d{2,4}$/i.test(token))break
    if(/^(FX|GRT|RTN|MAD|AE|BR\d+)$/i.test(token))break
    model.push(token)
    if(model.length>=3)break
  }
  return safeText(model.join(' '))
}

function canonicalProductName(model:string,desc:string,list:string){
  const category=categoryFrom(desc,list)
  const prettyModel=titleCase(model)
  if(!prettyModel)return category||titleCase(desc)||'Produto sem nome'
  if(category&&norm(prettyModel).startsWith(norm(category)))return prettyModel
  return category?`${category} ${prettyModel}`:prettyModel
}

async function fetchAllRows(supabase:SupabaseClient,jobId:string){
  const rows:any[]=[]
  const pageSize=1000
  for(let from=0;;from+=pageSize){
    const to=from+pageSize-1
    const {data,error}=await supabase.from('extraction_rows')
      .select('id,sheet_name,row_index,product_name_raw,supplier_product_code,dimension_label,raw_payload')
      .eq('job_id',jobId)
      .order('sheet_name',{ascending:true})
      .order('row_index',{ascending:true})
      .range(from,to)
    if(error)throw error
    const batch=data||[]
    rows.push(...batch)
    if(batch.length<pageSize)break
  }
  return rows
}

export async function recoverHistoricalSupplierExtraction(ctx:RecoveryContext){
  const {supabase,brand,document,jobId,products}=ctx
  const {data:duplicateDocs,error:docsError}=await supabase.from('source_documents')
    .select('id,filename,created_at')
    .eq('brand_id',brand.id)
    .eq('filename',document.filename)
    .order('created_at',{ascending:false})
  if(docsError)throw docsError
  const documentIds=(duplicateDocs||[]).map((d:any)=>d.id)
  if(!documentIds.length)return null

  const {data:jobs,error:jobsError}=await supabase.from('ingestion_jobs')
    .select('id,source_document_id,total_rows,status,parser_type,created_at')
    .in('source_document_id',documentIds)
    .neq('id',jobId)
    .gt('total_rows',0)
    .order('created_at',{ascending:false})
    .limit(10)
  if(jobsError)throw jobsError

  let sourceJob:any=null,oldRows:any[]=[]
  for(const candidate of jobs||[]){
    const rows=await fetchAllRows(supabase,candidate.id)
    if(rows.length){sourceJob=candidate;oldRows=rows;break}
  }
  if(!sourceJob||!oldRows.length)return null

  const brandProducts=products.filter((p:any)=>p.brand_id===brand.id)
  const {data:codes,error:codesError}=await supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id)
  if(codesError)throw codesError

  const extracted:any[]=[]
  const currentModelBySheet=new Map<string,string>()

  for(const src of oldRows){
    const raw=src.raw_payload||{}
    const sheet=safeText(src.sheet_name)||'Planilha'
    const heading=safeText(raw['PRODUTOS'])
    const desc=safeText(raw['DESCRIÇÃO']||src.product_name_raw)
    const list=safeText(raw['LISTA'])
    const rawCode=safeText(raw['CÓDIGO']||src.supplier_product_code)

    if(heading)currentModelBySheet.set(sheet,heading)
    if(!rawCode||!isCode(rawCode))continue

    const model=currentModelBySheet.get(sheet)||modelFromList(list)||safeText(src.product_name_raw)||rawCode
    const productName=canonicalProductName(model,desc,list)
    const dimension=safeText(raw['DIMENSÕES']||src.dimension_label)
    const parsedDim=parseDimensions(dimension)
    const moduleLabel=safeText(raw['Módulo'])
    const textile=safeText(raw['Tec Forn Leg. A'])

    const byCode=(codes||[]).find((x:any)=>norm(x.product_code)===norm(rawCode))
    const byManufacturer=brandProducts.find((p:any)=>norm(p.manufacturer_code)===norm(rawCode))
    const byName=brandProducts.find((p:any)=>norm(p.name)===norm(productName))
    const productId=byCode?.product_id||byManufacturer?.id||byName?.id||null

    for(const [priceIndex,pc] of PRICE_COLUMNS.entries()){
      const price=numberValue(raw[pc.key])
      if(price==null||price<=50)continue
      extracted.push({
        job_id:jobId,
        row_index:src.row_index,
        variant_index:priceIndex,
        sheet_name:sheet,
        source_locator:{sheet,row:src.row_index,legacy_column:pc.key,header:pc.label,variant_label:desc,module:moduleLabel},
        raw_payload:{historical_source_id:src.id,model,variant_label:desc,module:moduleLabel,textile_consumption:textile,list_label:list,base_retail:safeText(raw['BASE VAREJO']),price_by_legend:safeText(raw['PREÇO POR LEGENDA VAREJO'])},
        product_name_raw:productName,
        supplier_product_code:rawCode,
        product_id:productId,
        dimension_label:dimension||null,
        width_mm:parsedDim.width_mm||null,
        depth_mm:parsedDim.depth_mm||null,
        height_mm:parsedDim.height_mm||null,
        pricing_group:pc.label,
        finish_group:null,
        cost_price:document.price_basis==='cost'?price:null,
        price_value:price,
        price_basis:document.price_basis||'sale',
        currency:'BRL',
        confidence:productId?.96:.86,
        status:'review',
        notes:desc||null
      })
    }
  }

  if(!extracted.length)return null

  for(let i=0;i<extracted.length;i+=300){
    const {error}=await supabase.from('extraction_rows').insert(extracted.slice(i,i+300))
    if(error)throw error
  }

  const grouped=new Map<string,any[]>()
  for(const row of extracted){
    const key=norm(row.product_name_raw)
    if(!key)continue
    if(!grouped.has(key))grouped.set(key,[])
    grouped.get(key)!.push(row)
  }

  const proposals:any[]=[]
  for(const rows of grouped.values()){
    const first=rows[0]
    const target=rows.map((x:any)=>x.product_id).find(Boolean)||brandProducts.find((p:any)=>norm(p.name)===norm(first.product_name_raw))?.id||null
    const supplierCodes=uniq(rows.map((x:any)=>x.supplier_product_code).filter(Boolean))
    const variantLabels=uniq(rows.map((x:any)=>x.source_locator?.variant_label).filter(Boolean))
    const modules=uniq(rows.map((x:any)=>x.source_locator?.module).filter(Boolean))
    proposals.push({
      job_id:jobId,
      source_document_id:document.id,
      brand_id:brand.id,
      entity_type:'product',
      action:target?'update':'create',
      target_id:target,
      proposed_data:{
        name:first.product_name_raw,
        manufacturer_code:supplierCodes[0]||null,
        supplier_codes:supplierCodes,
        variant_labels:variantLabels,
        modules,
        dimensions:uniq(rows.map((x:any)=>x.dimension_label).filter(Boolean)),
        pricing_groups:PRICE_COLUMNS.map(x=>x.label),
        price_count:rows.length,
        price_basis:document.price_basis||'sale',
        recovery_strategy:'jardim_block_model'
      },
      current_data:target?brandProducts.find((p:any)=>p.id===target)||{}:{},
      source_locator:{sheet:first.sheet_name,codes:supplierCodes,name:first.product_name_raw},
      dependencies:{},
      confidence:Math.max(...rows.map((x:any)=>Number(x.confidence)||0)),
      status:'pending'
    })
  }

  for(let i=0;i<proposals.length;i+=200){
    const {error}=await supabase.from('change_proposals').insert(proposals.slice(i,i+200))
    if(error)throw error
  }

  return {
    rows:extracted,
    proposals,
    summary:{
      sheets:uniq(extracted.map((x:any)=>x.sheet_name)).length,
      mappings:[{strategy:'historical_block_recovery',model_heading:'PRODUTOS',code:'CÓDIGO',description:'DESCRIÇÃO',dimension:'DIMENSÕES',price_columns:PRICE_COLUMNS}],
      products_detected:grouped.size,
      prices_detected:extracted.length,
      matched:extracted.filter((x:any)=>x.product_id).length,
      recovery:'same_supplier_same_filename_historical_raw',
      source_job_id:sourceJob.id,
      source_rows:oldRows.length
    }
  }
}
