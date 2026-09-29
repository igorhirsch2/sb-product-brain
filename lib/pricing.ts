export function n(v: unknown) {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function money(v: unknown) {
  return n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function effectiveCost(source: number, ipiMode?: string, ipiRate?: number | null, freightMode?: string, freightValue?: number | null) {
  let value = n(source)
  if (ipiMode === 'additional' || ipiMode === 'add') value *= 1 + n(ipiRate) / 100
  if (freightMode === 'percentage') value *= 1 + n(freightValue) / 100
  if (freightMode === 'fixed') value += n(freightValue)
  return value
}

export function pricingMetrics(cost: number, sale: number, targetMarkup?: number | null, minimumMarkup?: number | null) {
  const c = n(cost), s = n(sale)
  const markup = c > 0 ? s / c : 0
  const margin = s > 0 ? (s - c) / s : 0
  const suggested = c * (n(targetMarkup) || 1)
  const discount = suggested > 0 ? (suggested - s) / suggested : 0
  return { markup, margin, suggested, discount, belowMinimum: !!minimumMarkup && markup < n(minimumMarkup) }
}
