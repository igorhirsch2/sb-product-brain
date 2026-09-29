'use client'

import { useEffect, useMemo, useState } from 'react'
import { money, STATUS_LABELS } from '@/lib/utils'

export default function ProductDetail({product,brand,supabase,onClose}:any){
  const [dimensions,setDimensions]=useState<any[]>([]),[entries,setEntries]=useState<any[]>([]),[terms,setTerms]=useState<any>(null)
  const [dimension,setDimension]=useState(''),[group,setGroup]=useState(''),[finish,setFinish]=useState(''),[sale,setSale]=useState('')
  useEffect(()=>{load()},[product.id])
  async function load(){
    const [d,e,t]=await Promise.all([
      supabase.from('product_dimensions').select('*').eq('product_id',product.id).order('sort_order'),
      supabase.from('price_entries').select('*,price_tables(*)').eq('product_id',product.id).order('created_at',{ascending:false}).limit(1000),
      brand?supabase.from('supplier_commercial_terms').select('*').eq('brand_id',brand.id).eq('status','approved').order('created_at',{ascending:false}).limit(1):Promise.resolve({data:[]})
    ])
    setDimensions(d.data||[]);setEntries(e.data||[]);setTerms(t.data?.[0]||null)
  }
  const groups=useMemo(()=>Array.from(new Set(entries.map((e:any)=>e.pricing_group).filter(Boolean))),[entries])
  const dimensionLabels=useMemo(()=>Array.from(new Set([...dimensions.map(d=>d.label),...entries.map((e:any)=>e.dimension_signature?.label).filter(Boolean)])),[dimensions,entries])
  const entry=useMemo(()=>entries.find((e:any)=>(!dimension||e.dimension_signature?.label===dimension)&&(!group||e.pricing_group===group))||entries[0],[entries,dimension,group])
  const cost=entry?.cost_price?Number(entry.cost_price):null
  const tableSale=entry?.suggested_retail?Number(entry.suggested_retail):null
  const targetMarkup=Number(terms?.target_markup||1.9),minMarkup=Number(terms?.minimum_markup||1.7)
  const suggested=cost?cost*targetMarkup:(tableSale||Number(entry?.price_value||0))
  useEffect(()=>{if(suggested)setSale(String(Math.round(suggested*100)/100))},[entry?.id,targetMarkup])
  const saleN=Number(sale||0),markup=cost&&saleN?saleN/cost:null,margin=cost&&saleN?((saleN-cost)/saleN)*100:null
  const health=!markup?'neutral':markup>=targetMarkup?'good':markup>=minMarkup?'warn':'bad'
  return <div className="modalBg"><div className="modal productModal"><div className="modalHead"><div><span className="eyebrow">{product.public_id||'PRODUTO'}</span><h2>{product.name}</h2><p className="muted">{brand?.name||'Sem fornecedor'} · {product.manufacturer_code||'sem código'} · {STATUS_LABELS[product.status]||product.status}</p></div><button onClick={onClose}>×</button></div>
    <div className="twoCols"><section className="panel pad"><h3>Configuração</h3><label className="field"><span>Medida</span><select value={dimension} onChange={e=>setDimension(e.target.value)}><option value="">Padrão / primeira disponível</option>{dimensionLabels.map((d:any)=><option key={d} value={d}>{d}</option>)}</select></label><label className="field"><span>Grupo de revestimento</span><select value={group} onChange={e=>setGroup(e.target.value)}><option value="">Primeiro disponível</option>{groups.map((g:any)=><option key={g} value={g}>{g}</option>)}</select></label><label className="field"><span>Revestimento / acabamento escolhido</span><input value={finish} onChange={e=>setFinish(e.target.value)} placeholder="Ex.: Bouclé Areia TC-3281"/></label><div className="priceOrigin"><span>Origem do preço</span><b>{entry?.price_tables?.name||'Sem tabela vinculada'}</b><small>{entry?.price_basis==='cost'?'Tabela de custo':'Tabela de venda'} · grupo {entry?.pricing_group||'—'}</small></div></section>
    <section className="panel pad"><h3>Simulação comercial</h3><div className="priceStack"><div><span>Custo efetivo</span><b>{money(cost)}</b></div><div><span>Markup alvo</span><b>{targetMarkup.toFixed(2)}</b></div><div><span>Preço sugerido</span><b>{money(suggested)}</b></div></div><label className="field saleField"><span>Preço da proposta</span><input type="number" step="0.01" value={sale} onChange={e=>setSale(e.target.value)}/></label><div className={`health ${health}`}><div><span>Markup realizado</span><b>{markup?markup.toFixed(3):'—'}</b></div><div><span>Margem bruta estimada</span><b>{margin?margin.toFixed(1)+'%':'—'}</b></div><small>{health==='good'?'Dentro da margem-alvo':health==='warn'?'Abaixo da meta, ainda acima do mínimo':health==='bad'?'Abaixo do markup mínimo — requer atenção':'Tabela de venda sem custo disponível'}</small></div></section></div>
    <div className="modalActions"><button onClick={onClose}>Fechar</button><button className="primary" onClick={()=>navigator.clipboard?.writeText(`${product.name} | ${dimension||'medida padrão'} | ${group||'grupo padrão'} | ${finish||'acabamento a definir'} | ${money(saleN)}`)}>Copiar configuração para orçamento</button></div>
  </div></div>
}
