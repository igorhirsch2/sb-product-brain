import { NextResponse } from 'next/server'
import { parseWorkbookBuffer } from '../../../lib/parser-server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente.' }, { status: 400 })
    const learnedRaw = String(form.get('learnedMapping') || '{}')
    const priceBasisRaw = String(form.get('priceBasis') || '')
    let learnedMapping: Record<string,string> = {}
    try { learnedMapping = JSON.parse(learnedRaw) } catch {}
    const result = await parseWorkbookBuffer(await file.arrayBuffer(), learnedMapping, priceBasisRaw || null)
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao interpretar a tabela.' }, { status: 500 })
  }
}
