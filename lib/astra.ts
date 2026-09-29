import type { SupabaseClient } from '@supabase/supabase-js'
import { norm, numberValue, parseDimensions, slug, uniq, type AnyRow } from './utils'

export type ParseContext = {
  supabase: SupabaseClient
  brand: AnyRow
  document: AnyRow
  jobId: string
  products: AnyRow[]
  aiProfile?: AnyRow | null
}

function detectHeader(matrix:any[][], learned:any){
  let best:any={row:-1,score:-1,map:{name:-1,code:-1,dimension:-1,width:-1,depth:-1,height:-1},priceCols:[]}
  for(let r=0;r<Math.min(40,matrix.length);r++){
    const cells=(matrix[r]||[]).map(norm)
    let score=0
    cells.forEach(c=>{
      if(/produto|modelo|descricao|item/.test(c))score+=4
      if(/codigo|referencia|ref\b/.test(c))score+=3
      if(/medida|dimens/.test(c))score+=3
      if(/preco|valor|grupo|tecido|couro|categoria/.test(c))score+=2
    })
    if(score<=best.score)continue
    const find=(re:RegExp)=>cells.findIndex(c=>re.test(c))
    const map={
      name:find(/produto|modelo|descricao|item/), code:find(/codigo|referencia|ref\b/),
      dimension:find(/medida|dimens/), width:find(/largura|\bl\b/),
      depth:find(/profundidade|\bp\b/), height:find(/altura|\ba\b/)
    }
    if(map.name<0&&map.code<0)continue
    const priceCols:any[]=[]
    cells.forEach((c,i)=>{
      if(Object.values(map).includes(i))return
      if(/preco|valor|grupo\s*[a-z0-9]|tecido\s*[a-z0-9]|couro\s*[a-z0-9]|categoria\s*[a-z0-9]/.test(c)){
        priceCols.push({index:i,name:String(matrix[r][i]||`Valor ${i+1}`),group:String(matrix[r][i]||`Grupo ${i+1}`)})
      }
    })
    if(!priceCols.length&&learned?.price_headers){
      const learnedHeaders=(learned.price_headers as string[]).map(norm)
      cells.forEach((c,i)=>{if(learnedHeaders.includes(c))priceCols.push({index:i,name:String(matrix[r][i]),group:String(matrix[r][i])})})
    }
    best={row:r,score,map,priceCols}
  }
  return best
}

export async function parseSupplierWorkbook(file:File,ctx:ParseContext){
  const {supabase,brand,document,jobId,products,aiProfile}=ctx
  const XLSX=await import('xlsx')
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'})
  const brandProducts=products.filter(p=>p.brand_id===brand.id)
  const {data:codes}=await supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id)
  const extracted:any[]=[]
  const mappings:any[]=[]

  for(const sheetName of wb.SheetNames){
    const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,raw:false,defval:''})
    if(!matrix.length)continue
    const h=detectHeader(matrix,aiProfile?.learned_mapping)
    if(h.row<0||!h.priceCols.length)continue
    mappings.push({sheet:sheetName,header_row:h.row,columns:h.map,price_columns:h.priceCols})
    let lastName='',lastCode=''
    for(let ri=h.row+1;ri<matrix.length;ri++){
      const row=matrix[ri]||[]
      const ownName=h.map.name>=0?String(row[h.map.name]??'').trim():''
      const ownCode=h.map.code>=0?String(row[h.map.code]??'').trim():''
      const name=ownName||lastName, code=ownCode||lastCode
      if(ownName)lastName=ownName
      if(ownCode)lastCode=ownCode
      if(!name&&!code)continue

      let d:any={}
      if(h.map.dimension>=0)d=parseDimensions(row[h.map.dimension])
      if(!d.dimension_label){
        const parts=[h.map.width>=0?row[h.map.width]:'',h.map.depth>=0?row[h.map.depth]:'',h.map.height>=0?row[h.map.height]:''].filter(Boolean)
        if(parts.length>=2){
          const vals=parts.map(numberValue)
          const mm=(x:any)=>x==null?null:Number(x)*(Number(x)<1000?10:1)
          d={dimension_label:parts.join(' x '),width_mm:mm(vals[0]),depth_mm:mm(vals[1]),height_mm:mm(vals[2])}
        }
      }
      const byCode=(codes||[]).find((x:any)=>code&&norm(x.product_code)===norm(code))
      const byManufacturer=brandProducts.find(p=>code&&norm(p.manufacturer_code)===norm(code))
      const byName=brandProducts.find(p=>name&&norm(p.name)===norm(name))
      const productId=byCode?.product_id||byManufacturer?.id||byName?.id||null

      for(const pc of h.priceCols){
        const price=numberValue(row[pc.index])
        if(price==null||price<=0)continue
        extracted.push({
          job_id:jobId,row_index:ri+1,variant_index:pc.index,sheet_name:sheetName,
          source_locator:{sheet:sheetName,row:ri+1,column:pc.index+1,header:pc.name},raw_payload:{row},
          product_name_raw:name||null,supplier_product_code:code||null,product_id:productId,
          dimension_label:d.dimension_label||null,width_mm:d.width_mm||null,depth_mm:d.depth_mm||null,height_mm:d.height_mm||null,
          pricing_group:pc.group||pc.name,finish_group:null,cost_price:document.price_basis==='cost'?price:null,
          price_value:price,price_basis:document.price_basis||null,currency:'BRL',
          confidence:Math.min(.98,(productId?.72:.52)+(code?.12:0)+(name?.08:0)+(d.dimension_label?.06:0)),status:'review'
        })
      }
    }
  }

  for(let i=0;i<extracted.length;i+=300){
    const {error}=await supabase.from('extraction_rows').insert(extracted.slice(i,i+300))
    if(error)throw error
  }

  const grouped=new Map<string,any[]>()
  for(const r of extracted){
    const key=norm(r.supplier_product_code)||norm(r.product_name_raw)
    if(!key)continue
    if(!grouped.has(key))grouped.set(key,[])
    grouped.get(key)!.push(r)
  }
  const proposals:any[]=[]
  for(const rows of grouped.values()){
    const first=rows[0], target=first.product_id
    proposals.push({
      job_id:jobId,source_document_id:document.id,brand_id:brand.id,entity_type:'product',action:target?'update':'create',target_id:target,
      proposed_data:{name:first.product_name_raw||first.supplier_product_code||'Produto sem nome',manufacturer_code:first.supplier_product_code||null,
        dimensions:uniq(rows.map(x=>x.dimension_label).filter(Boolean)),pricing_groups:uniq(rows.map(x=>x.pricing_group).filter(Boolean)),
        price_count:rows.length,price_basis:document.price_basis},
      current_data:target?brandProducts.find(p=>p.id===target)||{}:{},source_locator:{sheet:first.sheet_name,code:first.supplier_product_code,name:first.product_name_raw},
      dependencies:{},confidence:Math.max(...rows.map(x=>Number(x.confidence)||0)),status:'pending'
    })
  }
  for(let i=0;i<proposals.length;i+=200){
    const {error}=await supabase.from('change_proposals').insert(proposals.slice(i,i+200))
    if(error)throw error
  }
  return {rows:extracted,proposals,summary:{sheets:wb.SheetNames.length,mappings,products_detected:grouped.size,prices_detected:extracted.length,matched:extracted.filter(x=>x.product_id).length}}
}

export async function learnSupplierProfile(supabase:SupabaseClient,brandId:string,docType:string,summary:any,existing?:AnyRow|null){
  const mapping={...(existing?.learned_mapping||{}),last_mappings:summary.mappings,price_headers:uniq(summary.mappings.flatMap((m:any)=>m.price_columns?.map((p:any)=>p.name)||[]))}
  if(existing){
    await supabase.from('supplier_ai_profiles').update({version:(existing.version||1)+1,learned_mapping:mapping,successful_runs:(existing.successful_runs||0)+1,confidence:Math.min(.95,Number(existing.confidence||.55)+.04),last_used_at:new Date().toISOString()}).eq('id',existing.id)
  }else{
    await supabase.from('supplier_ai_profiles').insert({brand_id:brandId,document_type:docType,profile_name:`Astra · ${docType}`,version:1,fingerprints:{},learned_mapping:mapping,learned_rules:{},approved_examples:[],confidence:.55,successful_runs:1,is_active:true,last_used_at:new Date().toISOString()})
  }
}
