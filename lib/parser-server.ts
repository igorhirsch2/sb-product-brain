import * as XLSX from 'xlsx'

export type ParsedRow = {
  row_index: number
  variant_index: number
  sheet_name: string
  source_locator: Record<string, unknown>
  raw_payload: Record<string, unknown>
  product_name_raw?: string | null
  supplier_product_code?: string | null
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

const SYN: Record<string, string[]> = {
  product: ['produto', 'modelo', 'descricao', 'descrição', 'item', 'nome', 'linha'],
  code: ['codigo', 'código', 'cod', 'ref', 'referencia', 'referência', 'sku'],
  dimension: ['medida', 'medidas', 'dimensao', 'dimensão', 'dimensoes', 'dimensões', 'tamanho'],
  width: ['largura', 'larg', 'width'],
  depth: ['profundidade', 'prof', 'depth'],
  height: ['altura', 'alt', 'height'],
  price: ['preco', 'preço', 'valor', 'varejo', 'custo', 'price'],
}

function norm(v: unknown) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function headerKind(h: string, learned: Record<string, string>) {
  const k = norm(h)
  if (learned[k]) return learned[k]
  for (const [kind, words] of Object.entries(SYN)) {
    if (words.some((w) => k === norm(w) || k.includes(norm(w)))) return kind
  }
  if (/grupo\s*[a-z0-9]|tecido|couro|revest/.test(k)) return 'group_price'
  return ''
}

function parseMoney(v: unknown) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  let s = String(v ?? '').trim()
  if (!s || !/\d/.test(s)) return null
  s = s.replace(/R\$/gi, '').replace(/\s/g, '')
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d+(,\d+)$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  const x = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(x) && x >= 0 ? x : null
}

function parseDimText(v: unknown) {
  const s = String(v ?? '').toLowerCase().replace(/,/g, '.')
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(cm|mm|m)?/g)].map((m) => ({ v: Number(m[1]), u: m[2] || '' }))
  const toMm = (x: { v: number; u: string }) => x.u === 'm' ? Math.round(x.v * 1000) : x.u === 'mm' ? Math.round(x.v) : Math.round(x.v * 10)
  if (nums.length >= 2 && /[x×]/.test(s)) {
    return {
      label: String(v),
      width_mm: toMm(nums[0]),
      depth_mm: toMm(nums[1]),
      height_mm: nums[2] ? toMm(nums[2]) : null,
    }
  }
  return null
}

function asMm(v: unknown) {
  const x = parseMoney(v)
  return x == null ? null : x > 1000 ? Math.round(x) : Math.round(x * 10)
}

function scoreHeader(row: unknown[], learned: Record<string, string>) {
  let score = 0
  row.forEach((c) => {
    const k = headerKind(String(c || ''), learned)
    if (k) score += k === 'group_price' ? 1 : 2
  })
  return score
}

export async function parseWorkbookBuffer(buffer: ArrayBuffer, learnedMapping: Record<string, string> = {}, priceBasis: string | null = null) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const rows: ParsedRow[] = []
  const inferred: Record<string, string> = { ...learnedMapping }
  const sheetMeta: Record<string, unknown>[] = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true }) as unknown[][]
    if (!grid.length) continue

    let headerIdx = 0
    let best = -1
    for (let i = 0; i < Math.min(grid.length, 35); i++) {
      const s = scoreHeader(grid[i] || [], learnedMapping)
      if (s > best) {
        best = s
        headerIdx = i
      }
    }

    const headers = (grid[headerIdx] || []).map((x, i) => String(x || `col_${i + 1}`))
    const kinds = headers.map((h) => headerKind(h, learnedMapping))
    headers.forEach((h, i) => {
      if (kinds[i] && kinds[i] !== 'group_price') inferred[norm(h)] = kinds[i]
    })

    const productCol = kinds.findIndex((k) => k === 'product')
    const codeCol = kinds.findIndex((k) => k === 'code')
    const dimensionCol = kinds.findIndex((k) => k === 'dimension')
    const widthCol = kinds.findIndex((k) => k === 'width')
    const depthCol = kinds.findIndex((k) => k === 'depth')
    const heightCol = kinds.findIndex((k) => k === 'height')
    const explicitPriceCols = kinds.map((k, i) => k === 'price' || k === 'group_price' ? i : -1).filter((i) => i >= 0)

    const numericCounts = headers.map(() => 0)
    const nonEmptyCounts = headers.map(() => 0)
    for (let r = headerIdx + 1; r < Math.min(grid.length, headerIdx + 160); r++) {
      ;(grid[r] || []).forEach((v, i) => {
        if (v !== '' && v != null) {
          nonEmptyCounts[i]++
          if (parseMoney(v) != null) numericCounts[i]++
        }
      })
    }

    let priceCols = explicitPriceCols
    if (!priceCols.length) {
      priceCols = headers.map((_, i) => i).filter((i) =>
        i !== widthCol && i !== depthCol && i !== heightCol &&
        numericCounts[i] >= 3 && numericCounts[i] / Math.max(1, nonEmptyCounts[i]) > 0.65
      )
    }

    let lastProduct = ''
    let lastCode = ''
    let produced = 0

    for (let r = headerIdx + 1; r < grid.length; r++) {
      const row = grid[r] || []
      const p = productCol >= 0 ? String(row[productCol] || '').trim() : ''
      const c = codeCol >= 0 ? String(row[codeCol] || '').trim() : ''
      if (p) lastProduct = p
      if (c) lastCode = c

      const dim = dimensionCol >= 0 ? parseDimText(row[dimensionCol]) : null
      const width = widthCol >= 0 ? asMm(row[widthCol]) : dim?.width_mm ?? null
      const depth = depthCol >= 0 ? asMm(row[depthCol]) : dim?.depth_mm ?? null
      const height = heightCol >= 0 ? asMm(row[heightCol]) : dim?.height_mm ?? null
      const label = dimensionCol >= 0 && row[dimensionCol]
        ? String(row[dimensionCol])
        : [width, depth, height].filter(Boolean).length >= 2
          ? [width, depth, height].filter(Boolean).map((x) => `${Math.round(Number(x) / 10)}`).join(' x ') + ' cm'
          : null

      let vi = 0
      for (const pc of priceCols) {
        const price = parseMoney(row[pc])
        if (price == null || price === 0) continue
        const h = headers[pc] || ''
        const group = kinds[pc] === 'group_price' ? h : null
        const raw: Record<string, unknown> = {}
        headers.forEach((hh, i) => {
          if (row[i] !== '' && row[i] != null) raw[hh] = row[i]
        })
        const confidence = Math.min(
          0.99,
          0.38 +
          (lastProduct.length ? 0.20 : 0) +
          (lastCode.length ? 0.10 : 0) +
          (label?.length ? 0.12 : 0) +
          (group ? 0.08 : 0) +
          0.10
        )

        rows.push({
          row_index: r + 1,
          variant_index: vi++,
          sheet_name: sheetName,
          source_locator: { sheet: sheetName, row: r + 1, column: pc + 1, header: h },
          raw_payload: raw,
          product_name_raw: lastProduct || null,
          supplier_product_code: lastCode || null,
          dimension_label: label,
          width_mm: width,
          depth_mm: depth,
          height_mm: height,
          pricing_group: group,
          finish_group: null,
          price_value: price,
          price_basis: priceBasis,
          currency: 'BRL',
          confidence,
          status: 'review',
        })
        produced++
      }
    }

    sheetMeta.push({
      sheet: sheetName,
      header_row: headerIdx + 1,
      headers,
      price_columns: priceCols.map((i) => headers[i]),
      rows: produced,
    })
  }

  const products = new Set(rows.map((r) => r.supplier_product_code || r.product_name_raw).filter(Boolean))
  return {
    rows,
    mapping: inferred,
    fingerprint: { sheets: sheetMeta },
    summary: {
      sheets: sheetMeta.length,
      rows: rows.length,
      products: products.size,
      average_confidence: rows.length ? rows.reduce((a, r) => a + r.confidence, 0) / rows.length : 0,
    },
  }
}
