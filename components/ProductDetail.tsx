'use client'

import { useEffect, useMemo, useState } from 'react'
import { money, STATUS_LABELS } from '@/lib/utils'

export default function ProductDetail({product,brand,supabase,onClose}:any){
  const [dimensions,setDimensions]=useState<any[]>([])
  const [entries,setEntries]=useState<any[]>([])
  const [terms,setTerms]=useState<any>(null)
  const [codes,setCodes]=useState<any[]>([])
  const [documents,setDocuments]=useState<any[]>([])
  const [dimension,setDimension]=useState('')
  const [group,setGroup]=useState('')
  const [finish,setFinish]=useState('')
  const [sale,setSale]=useState('')
  const [tab,setTab]=useState<'commercial'|'source'>('commercial')
  const [sourceSearch,setSourceSearch]=useState('')
  const [markupDraft,setMarkupDraft]=useState<Record<string,string>>({})
  const [savingMarkup,setSavingMarkup]=useState('')

  useEffect(()=>{load()},[product.id])

  async function load(){
    const [d,e,t,c]=await Promise.all([
      supabase.from('product_dimensions').select('*').eq('product_id',product.id).order('sort_order'),
      supabase.from('price_entries').select('*,price_tables(*)').eq('product_id',product.id).order('created_at',{ascending:false}).limit(2000),
      brand?supabase.from('supplier_commercial_terms').select('*').eq('brand_id',brand.id).eq('status','approved').order('created_at',{ascending:false}).limit(1):Promise.resolve({data:[]}),
      supabase.from('product_brand_codes').select('*').eq('product_id',product.id).order('is_primary',{ascending:false})
    ])
    const entryRows=e.data||[]
    setDimensions(d.data||[])
    setEntries(entryRows)
    setTerms(t.data?.[0]||null)
    setCodes(c.data||[])

    const drafts:Record<string,string>={}
    entryRows.forEach((x:any)=>{const pt=x.price_tables;if(pt?.id&&drafts[pt.id]===undefined)drafts[pt.id]=pt.reference_markup??''})
    setMarkupDraft(drafts)

    const docIds=Array.from(new Set(entryRows.map((x:any)=>x.price_tables?.source_document_id).filter(Boolean))) as string[]
    if(docIds.length){
      const docs=await supabase.from('source_documents').select('*').in('id',docIds)
      setDocuments(docs.data||[])
    }else setDocuments([])
  }

  const groups=useMemo(()=>Array.from(new Set(entries.map((e:any)=>e.pricing_group).filter(Boolean))),[entries])
  const dimensionLabels=useMemo(()=>Array.from(new Set([...dimensions.map(d=>d.label),...entries.map((e:any)=>e.dimension_signature?.label).filter(Boolean)])),[dimensions,entries])
  const entry=useMemo(()=>entries.find((e:any)=>(!dimension||e.dimension_signature?.label===dimension)&&(!group||e.pricing_group===group))||entries[0],[entries,dimension,group])
  const variants=useMemo(()=>Array.from(new Set(entries.map((e:any)=>e.configuration?.variant_label).filter(Boolean))),[entries])
  const tables=useMemo(()=>{
    const map=new Map<string,any>()
    entries.forEach((e:any)=>{const t=e.price_tables;if(t?.id&&!map.has(t.id))map.set(t.id,t)})
    return Array.from(map.values())
  },[entries])
  const filteredEntries=useMemo(()=>{
    const q=sourceSearch.trim().toLowerCase()
    if(!q)return entries
    return entries.filter((e:any)=>[
      e.supplier_product_code,e.configuration?.variant_label,e.dimension_signature?.label,e.pricing_group,e.price_tables?.name
    ].filter(Boolean).join(' ').toLowerCase().includes(q))
  },[entries,sourceSearch])

  const tableMarkup=entry?.price_tables?.reference_markup?Number(entry.price_tables.reference_markup):null
  const sourcePrice=entry?.source_price!=null?Number(entry.source_price):entry?.price_value!=null?Number(entry.price_value):null
  const storedCost=entry?.cost_price!=null?Number(entry.cost_price):null
  const cost=storedCost||(entry?.price_basis==='sale'&&tableMarkup&&sourcePrice?sourcePrice/tableMarkup:entry?.price_basis==='cost'&&sourcePrice?sourcePrice:null)
  const storedRetail=entry?.suggested_retail!=null?Number(entry.suggested_retail):null
  const tableSale=storedRetail||(entry?.price_basis==='sale'?sourcePrice:entry?.price_basis==='cost'&&cost&&tableMarkup?cost*tableMarkup:null)
  const targetMarkup=terms?.target_markup!=null?Number(terms.target_markup):null
  const minMarkup=terms?.minimum_markup!=null?Number(terms.minimum_markup):null
  const suggested=cost&&targetMarkup?cost*targetMarkup:(tableSale||0)
  useEffect(()=>{if(suggested)setSale(String(Math.round(suggested*100)/100));else setSale('')},[entry?.id,targetMarkup,tableMarkup])
  const saleN=Number(sale||0)
  const markup=cost&&saleN?saleN/cost:null
  const margin=cost&&saleN?((saleN-cost)/saleN)*100:null
  const health=!cost||!markup||!targetMarkup?'neutral':markup>=targetMarkup?'good':minMarkup&&markup>=minMarkup?'warn':'bad'
  const primaryCode=codes.find((c:any)=>c.is_primary)?.product_code||product.manufacturer_code

  async function openDocument(doc:any){
    const {data,error}=await supabase.storage.from(doc.storage_bucket||'supplier-tables').createSignedUrl(doc.storage_path,300)
    if(error)return alert(error.message)
    window.open(data.signedUrl,'_blank')
  }

  async function saveReferenceMarkup(table:any){
    const raw=String(markupDraft[table.id]??'').replace(',','.')
    const value=Number(raw)
    if(!Number.isFinite(value)||value<=0)return alert('Informe um markup de referência maior que zero. Ex.: 1,90.')
    setSavingMarkup(table.id)
    try{
      if(table.source_document_id){
        const docUpdate=await supabase.from('source_documents').update({reference_markup:value}).eq('id',table.source_document_id)
        if(docUpdate.error)throw docUpdate.error
      }
      const ptUpdate=await supabase.from('price_tables').update({reference_markup:value}).eq('id',table.id)
      if(ptUpdate.error)throw ptUpdate.error
      await load()
    }catch(e:any){alert(e.message||String(e))}finally{setSavingMarkup('')}
  }

  function healthText(){
    if(!cost)return 'Informe o markup de referência da tabela para calcular o custo efetivo.'
    if(!targetMarkup)return 'Defina o markup alvo nas condições comerciais do fornecedor.'
    if(health==='good')return 'Dentro da margem-alvo.'
    if(health==='warn')return 'Abaixo da meta, ainda acima do mínimo.'
    if(health==='bad')return 'Abaixo do markup mínimo — requer atenção.'
    return 'Markup calculado em tempo real.'
  }

  return <div className="modalBg"><div className="modal productModal">
    <div className="modalHead"><div><span className="eyebrow">{product.public_id||'PRODUTO'}</span><h2>{product.name}</h2><p className="muted">{brand?.name||'Sem fornecedor'} · {primaryCode||'sem código'} · {STATUS_LABELS[product.status]||product.status}</p></div><button onClick={onClose}>×</button></div>

    <div className="productTabs">
      <button className={tab==='commercial'?'on':''} onClick={()=>setTab('commercial')}>Configuração comercial</button>
      <button className={tab==='source'?'on':''} onClick={()=>setTab('source')}>Origem e preços <span>{entries.length}</span></button>
    </div>

    {tab==='commercial'?<>
      <div className="twoCols">
        <section className="panel pad"><h3>Configuração</h3>
          <label className="field"><span>Medida</span><select value={dimension} onChange={e=>setDimension(e.target.value)}><option value="">Padrão / primeira disponível</option>{dimensionLabels.map((d:any)=><option key={d} value={d}>{d}</option>)}</select></label>
          <label className="field"><span>Grupo de revestimento</span><select value={group} onChange={e=>setGroup(e.target.value)}><option value="">Primeiro disponível</option>{groups.map((g:any)=><option key={g} value={g}>{g}</option>)}</select></label>
          <label className="field"><span>Revestimento / acabamento escolhido</span><input value={finish} onChange={e=>setFinish(e.target.value)} placeholder="Ex.: Bouclé Areia TC-3281"/></label>
          <div className="priceOrigin"><span>Origem do preço</span><b>{entry?.price_tables?.name||'Sem tabela vinculada'}</b><small>{entry?.price_basis==='cost'?'Tabela de custo':'Tabela de venda'} · grupo {entry?.pricing_group||'—'}{tableMarkup?` · markup ref. ${tableMarkup.toFixed(2)}`:''}</small><button onClick={()=>setTab('source')}>Ver rastreabilidade completa →</button></div>
        </section>
        <section className="panel pad"><h3>Simulação comercial</h3>
          <div className="priceStack"><div><span>Custo efetivo</span><b>{money(cost)}</b></div><div><span>Markup da tabela</span><b>{tableMarkup?tableMarkup.toFixed(2):'—'}</b></div><div><span>Markup alvo</span><b>{targetMarkup?targetMarkup.toFixed(2):'—'}</b></div><div><span>Preço sugerido</span><b>{money(suggested||tableSale)}</b></div></div>
          <label className="field saleField"><span>Preço da proposta</span><input type="number" step="0.01" value={sale} onChange={e=>setSale(e.target.value)}/></label>
          <div className={`health ${health}`}><div><span>Markup realizado</span><b>{markup?markup.toFixed(3):'—'}</b></div><div><span>Margem bruta estimada</span><b>{margin?margin.toFixed(1)+'%':'—'}</b></div><small>{healthText()}</small></div>
        </section>
      </div>
    </>:<div className="productSource">
      <div className="sourceHero"><div><span className="eyebrow">RASTREABILIDADE</span><h3>Origem permanente do produto</h3><p>Cada preço mantém vínculo com tabela, código, variação, medida e grupo.</p></div><input className="search" value={sourceSearch} onChange={e=>setSourceSearch(e.target.value)} placeholder="Buscar código, variação, medida…"/></div>

      <div className="sourceKpis">
        <article><span>Códigos fornecedor</span><strong>{codes.length||1}</strong><small>{codes.map((c:any)=>c.product_code).join(' · ')||product.manufacturer_code||'—'}</small></article>
        <article><span>Variações</span><strong>{variants.length}</strong><small>{variants.slice(0,4).join(' · ')||'—'}{variants.length>4?'…':''}</small></article>
        <article><span>Medidas</span><strong>{dimensionLabels.length}</strong><small>{dimensionLabels.slice(0,5).join(' · ')||'—'}</small></article>
        <article><span>Preços vinculados</span><strong>{entries.length}</strong><small>{groups.length} grupos de preço</small></article>
      </div>

      {tables.length>0&&<div className="sourceDocs"><h4>Tabelas e parâmetros de origem</h4>{tables.map((table:any)=>{const doc=documents.find((d:any)=>d.id===table.source_document_id);return <div className="sourceDocRow" key={table.id}><button className="sourceDocOpen" onClick={()=>doc&&openDocument(doc)} disabled={!doc}><span>{table.name}</span><small>{table.price_basis==='cost'?'Tabela de custo':'Tabela de venda'} · {doc?'abrir original ↗':'original indisponível'}</small></button><label><span>Markup de referência</span><div><input inputMode="decimal" value={markupDraft[table.id]??''} onChange={e=>setMarkupDraft(m=>({...m,[table.id]:e.target.value}))} placeholder="Ex.: 1,90"/><button onClick={()=>saveReferenceMarkup(table)} disabled={savingMarkup===table.id}>{savingMarkup===table.id?'Salvando…':'Aplicar'}</button></div><small>{table.price_basis==='sale'?'Custo = venda ÷ markup':'Venda de referência = custo × markup'}</small></label></div>})}</div>}

      <div className="sourceTableWrap"><table className="sourceTable"><thead><tr><th>Código</th><th>Variação</th><th>Medida</th><th>Grupo</th><th>Preço origem</th><th>Custo</th><th>Markup ref.</th><th>Tabela</th></tr></thead><tbody>{filteredEntries.map((e:any)=><tr key={e.id}><td><b>{e.supplier_product_code||'—'}</b></td><td>{e.configuration?.variant_label||'—'}</td><td>{e.dimension_signature?.label||'—'}</td><td>{e.pricing_group||'—'}</td><td><b>{money(e.source_price??e.price_value)}</b></td><td>{money(e.cost_price)}</td><td>{e.price_tables?.reference_markup?Number(e.price_tables.reference_markup).toFixed(2):'—'}</td><td>{e.price_tables?.name||'—'}</td></tr>)}</tbody></table>{filteredEntries.length===0&&<div className="empty">Nenhum preço encontrado.</div>}</div>
    </div>}

    <div className="modalActions"><button onClick={onClose}>Fechar</button>{tab==='commercial'&&<button className="primary" onClick={()=>navigator.clipboard?.writeText(`${product.name} | ${dimension||'medida padrão'} | ${group||'grupo padrão'} | ${finish||'acabamento a definir'} | ${money(saleN)} | markup ${markup?markup.toFixed(3):'—'}`)}>Copiar configuração para orçamento</button>}</div>
  </div></div>
}
