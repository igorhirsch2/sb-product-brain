export type AnyRow = Record<string, any>

export const DOC_LABELS: Record<string,string> = {
  price_table:'Tabela de preços', catalog:'Catálogo', technical_sheet:'Ficha técnica',
  finish_catalog:'Catálogo de acabamentos', commercial_terms:'Condições comerciais',
  promotion:'Promoção', other:'Outro'
}

export const STATUS_LABELS: Record<string,string> = {
  draft:'Rascunho', in_progress:'Em cadastro', in_review:'Em revisão', approved:'Aprovado',
  active:'Ativo', inactive:'Inativo', discontinued:'Descontinuado', archived:'Arquivado',
  queued:'Aguardando leitura', needs_review:'Revisão necessária', uploaded:'Enviado', processing:'Processando', review:'Revisão', error:'Erro', pending:'Pendente',
  applied:'Aplicado', rejected:'Rejeitado'
}

export const slug=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')
export const norm=(v:any)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
export const uniq=<T,>(a:T[])=>Array.from(new Set(a))
export const dateBR=(v:any)=>v?new Date(String(v).includes('T')?v:v+'T12:00:00').toLocaleDateString('pt-BR'):'—'
export const money=(v:any)=>v==null||v===''?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})

export function numberValue(v:any){
  if(typeof v==='number') return Number.isFinite(v)?v:null
  let s=String(v??'').trim().replace(/R\$|\s/g,'')
  if(!s||/^[-–—]+$/.test(s)) return null
  s=s.replace(/%$/,'')
  if(!/^[-+]?\d[\d.,]*$/.test(s)) return null
  const comma=s.lastIndexOf(','), dot=s.lastIndexOf('.')
  if(comma>=0&&dot>=0){
    if(comma>dot) s=s.replace(/\./g,'').replace(',','.')
    else s=s.replace(/,/g,'')
  }else if(comma>=0){
    const decimals=s.length-comma-1
    s=decimals===3&&comma>0?s.replace(/,/g,''):s.replace(',','.')
  }else if(dot>=0){
    const decimals=s.length-dot-1
    if(decimals===3&&dot>0&&/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'')
  }
  const n=Number(s)
  return Number.isFinite(n)?n:null
}

export function parseDimensions(v:any){
  const text=String(v??'').trim()
  const m=text.match(/^(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)(?:\s*[xX×]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)?$/i)
  const mm=(x:string|undefined,unit:string|undefined)=>{if(!x)return null;const n=Number(x.replace(',','.'));return Number.isFinite(n)?Math.round(n*(unit==='m'?1000:unit==='mm'?1:unit==='cm'?10:n<10?1000:n<1000?10:1)):null}
  if(m) return {width_mm:mm(m[1],m[4]?.toLowerCase()),depth_mm:mm(m[2],m[4]?.toLowerCase()),height_mm:mm(m[3],m[4]?.toLowerCase()),dimension_label:text}
  const one=text.match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?$/i)
  if(one) return {width_mm:mm(one[1],one[2]?.toLowerCase()),depth_mm:null,height_mm:null,dimension_label:text}
  return {}
}

export function effectiveCost(base:number,doc:AnyRow){
  let v=base
  if(doc.ipi_mode==='additional_percent'&&doc.ipi_rate) v*=1+Number(doc.ipi_rate)/100
  if(doc.freight_mode==='additional_percent'&&doc.freight_value) v*=1+Number(doc.freight_value)/100
  if(doc.freight_mode==='additional_fixed'&&doc.freight_value) v+=Number(doc.freight_value)
  return Math.round(v*100)/100
}
