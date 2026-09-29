import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveCost, norm, slug, uniq, type AnyRow } from './utils'

export async function applyProductProposal(opts:{supabase:SupabaseClient; proposal:AnyRow; brand:AnyRow; userId:string}){
  const {supabase,proposal,brand,userId}=opts
  const {data:doc,error:docError}=await supabase.from('source_documents').select('*').eq('id',proposal.source_document_id).single()
  if(docError)throw docError
  const pd=proposal.proposed_data||{}
  let productId=proposal.target_id as string|undefined

  const productPayload={name:pd.name,brand_id:brand.id,manufacturer_code:pd.manufacturer_code||null,product_type:pd.product_type||pd.category||null,updated_by:userId}
  if(!productId){
    let base=slug(pd.name||pd.manufacturer_code||'produto'), candidate=base, n=2
    while((await supabase.from('products').select('id',{count:'exact',head:true}).eq('slug',candidate)).count) candidate=`${base}-${n++}`
    const created=await supabase.from('products').insert({...productPayload,slug:candidate,status:'in_review',created_by:userId}).select().single()
    if(created.error)throw created.error
    productId=created.data.id
  }else{
    const updated=await supabase.from('products').update(productPayload).eq('id',productId)
    if(updated.error)throw updated.error
  }

  const supplierCodes=uniq<string>((pd.supplier_codes?.length?pd.supplier_codes:[pd.manufacturer_code]).filter(Boolean))
  for(const [i,c] of supplierCodes.entries()){
    const code=await supabase.from('product_brand_codes').upsert({product_id:productId,brand_id:brand.id,product_code:String(c),is_primary:i===0,metadata:{source_document_id:proposal.source_document_id}},{onConflict:'brand_id,product_code'})
    if(code.error)throw code.error
  }

  const extraction=await supabase.from('extraction_rows').select('*').eq('job_id',proposal.job_id)
  if(extraction.error)throw extraction.error
  const sourceCodes=uniq<string>(((pd._source_supplier_codes?.length?pd._source_supplier_codes:supplierCodes)||[]).filter(Boolean))
  let rows=(extraction.data||[]).filter((r:any)=>{
    if(sourceCodes.some(c=>norm(c)===norm(r.supplier_product_code)))return true
    return pd.name&&norm(r.product_name_raw)===norm(pd.name)
  })

  if(Array.isArray(pd.included_variant_labels)){
    const allowed=new Set(pd.included_variant_labels.map((x:any)=>norm(x)))
    rows=rows.filter((r:any)=>allowed.has(norm(r.source_locator?.variant_label||r.notes||'')))
  }
  if(Array.isArray(pd.included_dimensions)){
    const allowed=new Set(pd.included_dimensions.map((x:any)=>norm(x)))
    rows=rows.filter((r:any)=>allowed.has(norm(r.dimension_label||'')))
  }
  if(Array.isArray(pd.included_pricing_groups)){
    const allowed=new Set(pd.included_pricing_groups.map((x:any)=>norm(x)))
    rows=rows.filter((r:any)=>allowed.has(norm(r.pricing_group||'')))
  }

  if(!rows.length)throw new Error('A proposta ficou sem linhas de origem após as correções. Revise códigos, variações, medidas e grupos de preço antes de aprovar.')

  const existingDims=await supabase.from('product_dimensions').select('*').eq('product_id',productId)
  if(existingDims.error)throw existingDims.error
  const seen=new Set((existingDims.data||[]).map((d:any)=>norm(d.label)))
  for(const r of rows){
    if(r.dimension_label&&!seen.has(norm(r.dimension_label))){
      const ins=await supabase.from('product_dimensions').insert({product_id:productId,label:r.dimension_label,width_mm:r.width_mm,depth_mm:r.depth_mm,height_mm:r.height_mm,is_default:false,sort_order:seen.size,metadata:{source_document_id:proposal.source_document_id}})
      if(ins.error)throw ins.error
      seen.add(norm(r.dimension_label))
    }
  }

  const groups=uniq<string>(rows.map((r:any)=>r.pricing_group).filter(Boolean))
  if(groups.length){
    const groupCode=`${slug(brand.name)}-grupo-preco`
    let {data:group,error:gerr}=await supabase.from('option_groups').select('*').eq('code',groupCode).maybeSingle()
    if(gerr)throw gerr
    if(!group){
      const gi=await supabase.from('option_groups').insert({code:groupCode,name:`Revestimento / Grupo de preço · ${brand.name}`,kind:'textile',selection_mode:'single',is_active:true}).select().single()
      if(gi.error)throw gi.error
      group=gi.data
    }
    const pog=await supabase.from('product_option_groups').upsert({product_id:productId,option_group_id:group.id,is_required:false,min_select:0,max_select:1,sort_order:0},{onConflict:'product_id,option_group_id'})
    if(pog.error)throw pog.error
    for(const [i,g] of groups.entries()){
      const valueCode=`${groupCode}-${slug(String(g))}`
      let {data:value,error:verr}=await supabase.from('option_values').select('*').eq('option_group_id',group.id).eq('code',valueCode).maybeSingle()
      if(verr)throw verr
      if(!value){
        const vi=await supabase.from('option_values').insert({option_group_id:group.id,code:valueCode,name:String(g),normalized_name:norm(g),sort_order:i,metadata:{brand_id:brand.id},is_active:true}).select().single()
        if(vi.error)throw vi.error
        value=vi.data
      }
      const pov=await supabase.from('product_option_values').upsert({product_id:productId,option_value_id:value.id,supplier_code:String(g),is_default:false,is_active:true,metadata:{}},{onConflict:'product_id,option_value_id'})
      if(pov.error)throw pov.error
    }
  }

  const variants=uniq<string>((pd.variant_labels||[]).filter((v:any)=>v&&norm(v)!==norm(pd.name)))
  if(variants.length>1){
    const groupCode=`${slug(brand.name)}-${slug(pd.name)}-variacao`
    let {data:vg,error:vgErr}=await supabase.from('option_groups').select('*').eq('code',groupCode).maybeSingle()
    if(vgErr)throw vgErr
    if(!vg){
      const ins=await supabase.from('option_groups').insert({code:groupCode,name:'Variação',kind:'other',selection_mode:'single',is_active:true}).select().single()
      if(ins.error)throw ins.error
      vg=ins.data
    }
    const rel=await supabase.from('product_option_groups').upsert({product_id:productId,option_group_id:vg.id,is_required:false,min_select:0,max_select:1,sort_order:1},{onConflict:'product_id,option_group_id'})
    if(rel.error)throw rel.error
    for(const [i,v] of variants.entries()){
      const valueCode=`${groupCode}-${slug(v)}`
      let {data:value}=await supabase.from('option_values').select('*').eq('option_group_id',vg.id).eq('code',valueCode).maybeSingle()
      if(!value){
        const vi=await supabase.from('option_values').insert({option_group_id:vg.id,code:valueCode,name:v,normalized_name:norm(v),sort_order:i,metadata:{brand_id:brand.id},is_active:true}).select().single()
        if(vi.error)throw vi.error
        value=vi.data
      }
      const pov=await supabase.from('product_option_values').upsert({product_id:productId,option_value_id:value.id,supplier_code:null,is_default:false,is_active:true,metadata:{}},{onConflict:'product_id,option_value_id'})
      if(pov.error)throw pov.error
    }
  }

  let {data:priceTable,error:ptErr}=await supabase.from('price_tables').select('*').eq('source_document_id',proposal.source_document_id).maybeSingle()
  if(ptErr)throw ptErr
  if(!priceTable){
    const pti=await supabase.from('price_tables').insert({brand_id:brand.id,source_document_id:proposal.source_document_id,name:doc.filename,currency:'BRL',valid_from:doc.valid_from,valid_until:doc.valid_until,status:'active',metadata:{job_id:proposal.job_id},price_basis:doc.price_basis,reference_markup:doc.reference_markup,ipi_mode:doc.ipi_mode,ipi_rate:doc.ipi_rate,freight_mode:doc.freight_mode,freight_value:doc.freight_value,created_by:userId}).select().single()
    if(pti.error)throw pti.error
    priceTable=pti.data
  }else if(priceTable.reference_markup!==doc.reference_markup){
    const ptUpdate=await supabase.from('price_tables').update({reference_markup:doc.reference_markup}).eq('id',priceTable.id).select().single()
    if(ptUpdate.error)throw ptUpdate.error
    priceTable=ptUpdate.data
  }

  const referenceMarkup=Number(doc.reference_markup||priceTable.reference_markup||0)||null
  const overrides=pd.price_overrides||{}
  const entries=rows.map((r:any)=>{
    const overridden=Object.prototype.hasOwnProperty.call(overrides,r.id)
    const source=overridden?Number(overrides[r.id]):Number(r.price_value)
    const finalValue=doc.price_basis==='cost'?effectiveCost(source,doc):source
    const derivedCost=doc.price_basis==='sale'&&referenceMarkup?source/referenceMarkup:doc.price_basis==='cost'?finalValue:null
    const derivedRetail=doc.price_basis==='sale'?source:doc.price_basis==='cost'&&referenceMarkup?finalValue*referenceMarkup:null
    return {price_table_id:priceTable.id,extraction_row_id:r.id,product_id:productId,supplier_product_code:r.supplier_product_code,dimension_signature:{label:r.dimension_label,width_mm:r.width_mm,depth_mm:r.depth_mm,height_mm:r.height_mm},pricing_group:r.pricing_group,finish_group:r.finish_group,configuration:{variant_label:r.source_locator?.variant_label||r.notes||null,review_override:overridden||false},cost_price:derivedCost,suggested_retail:derivedRetail,currency:'BRL',source_locator:r.source_locator,price_basis:doc.price_basis||'sale',source_price:source,ipi_rate:doc.ipi_rate,freight_value:doc.freight_value,price_value:finalValue}
  })
  for(let i=0;i<entries.length;i+=250){
    const pe=await supabase.from('price_entries').upsert(entries.slice(i,i+250),{onConflict:'price_table_id,extraction_row_id'})
    if(pe.error)throw pe.error
  }

  if(rows.length){
    const xr=await supabase.from('extraction_rows').update({product_id:productId,status:'approved'}).in('id',rows.map((r:any)=>r.id))
    if(xr.error)throw xr.error
  }
  const cp=await supabase.from('change_proposals').update({target_id:productId,status:'applied',reviewed_by:userId,reviewed_at:new Date().toISOString(),applied_at:new Date().toISOString()}).eq('id',proposal.id)
  if(cp.error)throw cp.error

  const remaining=await supabase.from('change_proposals').select('id',{count:'exact',head:true}).eq('source_document_id',proposal.source_document_id).eq('status','pending')
  if(!remaining.count)await supabase.from('source_documents').update({status:'approved',approval_status:'approved'}).eq('id',proposal.source_document_id)
  return productId
}
