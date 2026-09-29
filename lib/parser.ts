export type ParsedRow = {
  row_index: number
  variant_index: number
  sheet_name: string
  source_locator: Record<string, unknown>
  raw_payload: Record<string, unknown>
  product_name_raw?: string | null
  supplier_product_code?: string | null
  product_id?: string | null
  dimension_label?: string | null
  width_mm?: number | null
  depth_mm?: number | null
  height_mm?: number | null
  pricing_group?: string | null
  finish_group?: string | null
  price_value?: number | null
  price_basis?: string | null
  currency: string
  confidence: number
  status: string
  notes?: string | null
}

export type ParseResult = {
  rows: ParsedRow[]
  mapping: Record<string,string>
  fingerprint: Record<string,unknown>
  summary: Record<string,any>
}

export function norm(v: unknown) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
}

export async function parseWorkbook(file: File, learnedMapping: Record<string,string> = {}, priceBasis: string | null = null): Promise<ParseResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('learnedMapping', JSON.stringify(learnedMapping || {}))
  form.append('priceBasis', priceBasis || '')
  const response = await fetch('/api/parse-table', { method: 'POST', body: form })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error || 'Falha ao interpretar a tabela.')
  return payload as ParseResult
}

export function groupProductProposals(rows: ParsedRow[]) {
  const map=new Map<string,ParsedRow[]>()
  rows.forEach(r=>{
    const key=norm(r.supplier_product_code||r.product_name_raw||'')
    if(!key)return
    if(!map.has(key))map.set(key,[])
    map.get(key)!.push(r)
  })
  return [...map.entries()].map(([key,rs])=>{
    const first=rs.find(r=>r.product_name_raw)||rs[0]
    const dimensions=[...new Map(rs.filter(r=>r.dimension_label).map(r=>[
      norm(r.dimension_label),
      {label:r.dimension_label,width_mm:r.width_mm,depth_mm:r.depth_mm,height_mm:r.height_mm}
    ])).values()]
    const groups=[...new Set(rs.map(r=>r.pricing_group).filter(Boolean))] as string[]
    return {
      key,
      name:first.product_name_raw||first.supplier_product_code||'Produto sem nome',
      code:first.supplier_product_code||null,
      dimensions,
      groups,
      prices:rs.map(r=>({
        row_index:r.row_index,
        sheet_name:r.sheet_name,
        source_locator:r.source_locator,
        dimension_label:r.dimension_label,
        width_mm:r.width_mm,
        depth_mm:r.depth_mm,
        height_mm:r.height_mm,
        pricing_group:r.pricing_group,
        price_value:r.price_value,
        price_basis:r.price_basis,
        currency:r.currency
      })),
      confidence:rs.reduce((a,r)=>a+r.confidence,0)/rs.length
    }
  })
}
