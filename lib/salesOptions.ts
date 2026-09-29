import type { SupabaseClient } from '@supabase/supabase-js'

export async function syncSalesOptionsForPriceTable(supabase:SupabaseClient, priceTableId:string){
  const {data:table,error:tableError}=await supabase.from('price_tables').select('id,brand_id,reference_markup').eq('id',priceTableId).single()
  if(tableError)throw tableError
  if(!table?.brand_id)return

  const {data:terms}=await supabase.from('supplier_commercial_terms').select('target_markup,minimum_markup').eq('brand_id',table.brand_id).eq('status','approved').order('created_at',{ascending:false}).limit(1)
  const target=terms?.[0]?.target_markup!=null?Number(terms[0].target_markup):null
  const minimum=terms?.[0]?.minimum_markup!=null?Number(terms[0].minimum_markup):null
  const reference=table.reference_markup!=null?Number(table.reference_markup):null

  let offset=0
  const pageSize=1000
  while(true){
    const {data:entries,error}=await supabase.from('price_entries').select('id,product_id,supplier_product_code,dimension_signature,pricing_group,configuration,cost_price,suggested_retail,price_basis,source_price,price_value').eq('price_table_id',priceTableId).range(offset,offset+pageSize-1)
    if(error)throw error
    const rows=entries||[]
    if(!rows.length)break

    const safeRows=rows.map((e:any)=>{
      const source=e.source_price!=null?Number(e.source_price):e.price_value!=null?Number(e.price_value):null
      const cost=e.cost_price!=null?Number(e.cost_price):e.price_basis==='sale'&&reference&&source?source/reference:e.price_basis==='cost'?source:null
      const display=e.suggested_retail!=null?Number(e.suggested_retail):e.price_basis==='sale'?source:e.price_basis==='cost'&&cost&&reference?cost*reference:null
      return {
        price_entry_id:e.id,
        product_id:e.product_id,
        supplier_product_code:e.supplier_product_code||null,
        dimension_label:e.dimension_signature?.label||null,
        pricing_group:e.pricing_group||null,
        variant_label:e.configuration?.variant_label||null,
        display_price:display,
        target_sale_price:cost&&target?cost*target:null,
        minimum_sale_price:cost&&minimum?cost*minimum:null,
        updated_at:new Date().toISOString()
      }
    })

    const {error:upsertError}=await supabase.from('sales_price_options').upsert(safeRows,{onConflict:'price_entry_id'})
    if(upsertError)throw upsertError
    if(rows.length<pageSize)break
    offset+=pageSize
  }
}

export async function syncSalesOptionsForBrand(supabase:SupabaseClient, brandId:string){
  const {data,error}=await supabase.from('price_tables').select('id').eq('brand_id',brandId)
  if(error)throw error
  for(const table of data||[])await syncSalesOptionsForPriceTable(supabase,table.id)
}
