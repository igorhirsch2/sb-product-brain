import { numberValue, type AnyRow } from './utils'

export function priceOverrides(values:Record<string,unknown> = {}){
  const result:Record<string,number>={}
  for(const [id,value] of Object.entries(values)){
    if(value===''||value==null)continue
    const parsed=numberValue(value)
    if(parsed==null||parsed<=0)throw new Error('Informe preços válidos maiores que zero. Exemplo: 1.234,56.')
    result[id]=parsed
  }
  return result
}

export function selectProposalRows(allRows:AnyRow[],pd:AnyRow){
  const codes=pd._source_supplier_codes||pd.supplier_codes||[pd.manufacturer_code].filter(Boolean)
  const originalName=pd._human_review?.original?.name||pd.name
  let rows=allRows.filter(r=>codes.length?codes.includes(r.supplier_product_code):r.product_name_raw===originalName)
  for(const [field,getValue] of [
    ['included_variant_labels',(r:AnyRow)=>r.source_locator?.variant_label||r.notes||''],
    ['included_dimensions',(r:AnyRow)=>r.dimension_label||''],
    ['included_pricing_groups',(r:AnyRow)=>r.pricing_group||'']
  ] as const){
    if(Array.isArray(pd[field])){
      const allowed=new Set(pd[field])
      // Blank metadata was never a selectable option and must not remove valid prices.
      rows=rows.filter(r=>!getValue(r)||allowed.has(getValue(r)))
    }
  }
  const overrides=priceOverrides(pd.price_overrides)
  if(!rows.length)throw new Error('Nenhum preço selecionado. Revise variações, medidas e grupos antes de aprovar.')
  for(const row of rows){const value=overrides[row.id]??numberValue(row.price_value);if(value==null||value<=0)throw new Error(`Preço inválido na linha ${row.row_index}. Corrija antes de aprovar.`)}
  return rows
}
