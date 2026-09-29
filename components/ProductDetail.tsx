'use client'

import { useEffect, useMemo, useState } from 'react'
import { money, STATUS_LABELS } from '@/lib/utils'
import { syncSalesOptionsForPriceTable } from '@/lib/salesOptions'

const FINANCIAL_ROLES=['diretoria','admin','comercial']

export default function ProductDetail({product,brand,supabase,userRole,onClose}:any){
  const canSeeInternal=FINANCIAL_ROLES.includes(String(userRole||''))
  const [dimensions,setDimensions]=useState<any[]>([])
  const [safeOptions,setSafeOptions]=useState<any[]>([])
  const [entries,setEntries]=useState<any[]>([])
  const [terms,setTerms]=useState<any>(null)
  const [codes,setCodes]=useState<any[]>([])
  const [documents,setDocuments]=useState<any[]>([])
  const [dimension,setDimension]=useState('')
  const [group,setGroup]=useState('')
  const [variant,setVariant]=useState('')
  const [finish,setFinish]=useState('')
  const [sale,setSale]=useState('')
  const [tab,setTab]=useState<'sales'|'internal'|'source'>('sales')
  const [presenting,setPresenting]=useState(false)
  const [sourceSearch,setSourceSearch]=useState('')
  const [markupDraft,setMarkupDraft]=useState<Record<string,string>>({})
  const [savingMarkup,setSavingMarkup]=useState('')

  useEffect(()=>{load()},[product.id,userRole])

  async function load(){
    const [d,s,c]=await Promise.all([
      supabase.from('product_dimensions').select('*').eq('product_id',product.id).order('sort_order'),
      supabase.from('sales_price_options').select('*').eq('product_id',product.id).order('updated_at',{ascending:false}).limit(3000),
      supabase.from('product_brand_codes').select('*').eq('product_id',product.id).order('is_primary',{ascending:false})
    ])
    setDimensions(d.data||[])
    setSafeOptions(s.data||[])
    setCodes(c.data||[])

    if(!canSeeInternal){
      setEntries([]);setTerms(null);setDocuments([]);return
    }

    const [e,t]=await Promise.all([
      supabase.from('price_entries').select('*,price_tables(*)').eq('product_id',product.id).order('created_at',{ascending:false}).limit(3000),
      brand?supabase.from('supplier_commercial_terms').select('*').eq('brand_id',brand.id).eq('status','approved').order('created_at',{ascending:false}).limit(1):Promise.resolve({data:[]})
    ])
    const entryRows=e.data||[]
    setEntries(entryRows)
    setTerms(t.data?.[0]||null)

    const drafts:Record<string,string>={}
    entryRows.forEach((x:any)=>{const pt=x.price_tables;if(pt?.id&&drafts[pt.id]===undefined)drafts[pt.id]=pt.reference_markup??''})
    setMarkupDraft(drafts)

    const docIds=Array.from(new Set(entryRows.map((x:any)=>x.price_tables?.source_document_id).filter(Boolean))) as string[]
    if(docIds.length){
      const docs=await supabase.from('source_documents').select('*').in('id',docIds)
      setDocuments(docs.data||[])
    }else setDocuments([])
  }

  const dimensionLabels=useMemo(()=>Array.from(new Set([...dimensions.map((d:any)=>d.label),...safeOptions.map((e:any)=>e.dimension_label).filter(Boolean)])),[dimensions,safeOptions])
  const groups=useMemo(()=>Array.from(new Set(safeOptions.map((e:any)=>e.pricing_group).filter(Boolean))),[safeOptions])
  const variants=useMemo(()=>Array.from(new Set(safeOptions.map((e:any)=>e.variant_label).filter(Boolean))),[safeOptions])
  const safeEntry=useMemo(()=>safeOptions.find((e:any)=>(!dimension||e.dimension_label===dimension)&&(!group||e.pricing_group===group)&&(!variant||e.variant_label===variant))||safeOptions[0],[safeOptions,dimension,group,variant])
  const entry=useMemo(()=>entries.find((e:any)=>e.id===safeEntry?.price_entry_id)||entries[0],[entries,safeEntry?.price_entry_id])
  const tables=useMemo(()=>{const map=new Map<string,any>();entries.forEach((e:any)=>{const t=e.price_tables;if(t?.id&&!map.has(t.id))map.set(t.id,t)});return Array.from(map.values())},[entries])
  const filteredEntries=useMemo(()=>{const q=sourceSearch.trim().toLowerCase();if(!q)return entries;return entries.filter((e:any)=>[e.supplier_product_code,e.configuration?.variant_label,e.dimension_signature?.label,e.pricing_group,e.price_tables?.name].filter(Boolean).join(' ').toLowerCase().includes(q))},[entries,sourceSearch])

  const tablePrice=safeEntry?.display_price!=null?Number(safeEntry.display_price):0
  useEffect(()=>{setSale(tablePrice?String(Math.round(tablePrice*100)/100):'')},[safeEntry?.price_entry_id,tablePrice])
  const saleN=Number(sale||0)
  const targetSale=safeEntry?.target_sale_price!=null?Number(safeEntry.target_sale_price):null
  const minimumSale=safeEntry?.minimum_sale_price!=null?Number(safeEntry.minimum_sale_price):null
  const policyStatus=!saleN||(!targetSale&&!minimumSale)?'neutral':targetSale&&saleN>=targetSale?'good':minimumSale&&saleN>=minimumSale?'warn':minimumSale&&saleN<minimumSale?'bad':'warn'
  const policyMessage=policyStatus==='good'?'Preço dentro da política comercial.':policyStatus==='warn'?'Preço permitido, mas próximo do limite comercial.':policyStatus==='bad'?'Este valor requer aprovação da gerência.':'Política comercial ainda não definida para este item.'

  const tableMarkup=entry?.price_tables?.reference_markup?Number(entry.price_tables.reference_markup):null
  const sourcePrice=entry?.source_price!=null?Number(entry.source_price):entry?.price_value!=null?Number(entry.price_value):null
  const cost=entry?.cost_price!=null?Number(entry.cost_price):entry?.price_basis==='sale'&&tableMarkup&&sourcePrice?sourcePrice/tableMarkup:entry?.price_basis==='cost'&&sourcePrice?sourcePrice:null
  const targetMarkup=terms?.target_markup!=null?Number(terms.target_markup):null
  const minMarkup=terms?.minimum_markup!=null?Number(terms.minimum_markup):null
  const realizedMarkup=cost&&saleN?saleN/cost:null
  const margin=cost&&saleN?((saleN-cost)/saleN)*100:null
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
      await syncSalesOptionsForPriceTable(supabase,table.id)
      await load()
    }catch(e:any){alert(e.message||String(e))}finally{setSavingMarkup('')}
  }

  if(presenting)return <div className="customerPresent">
    <button className="presentExit" onClick={()=>setPresenting(false)}>Sair da apresentação</button>
    <div className="presentBrand">{brand?.name||'Grupo SB'}</div>
    <div className="presentCard"><span className="eyebrow">SELEÇÃO</span><h1>{product.name}</h1><div className="presentDetails">
      <div><span>Medida</span><b>{dimension||safeEntry?.dimension_label||'A definir'}</b></div>
      <div><span>Variação</span><b>{variant||safeEntry?.variant_label||'A definir'}</b></div>
      <div><span>Grupo de revestimento</span><b>{group||safeEntry?.pricing_group||'A definir'}</b></div>
      <div><span>Revestimento / acabamento</span><b>{finish||'A definir'}</b></div>
    </div><div className="presentPrice"><span>Valor</span><strong>{money(saleN||tablePrice)}</strong></div></div>
  </div>

  return <div className="modalBg"><div className="modal productModal">
    <div className="modalHead"><div><span className="eyebrow">{product.public_id||'PRODUTO'}</span><h2>{product.name}</h2><p className="muted">{brand?.name||'Sem fornecedor'} · {primaryCode||'sem código'} · {STATUS_LABELS[product.status]||product.status}</p></div><div className="productHeadActions"><button className="presentBtn" onClick={()=>setPresenting(true)}>Apresentar ao cliente</button><button onClick={onClose}>×</button></div></div>

    <div className="productTabs">
      <button className={tab==='sales'?'on':''} onClick={()=>setTab('sales')}>Atendimento</button>
      {canSeeInternal&&<button className={tab==='internal'?'on':''} onClick={()=>setTab('internal')}>Informações internas</button>}
      {canSeeInternal&&<button className={tab==='source'?'on':''} onClick={()=>setTab('source')}>Origem e preços <span>{entries.length}</span></button>}
    </div>

    {tab==='sales'&&<div className="salesMode">
      <section className="panel pad"><h3>Configuração do produto</h3>
        {variants.length>1&&<label className="field"><span>Variação</span><select value={variant} onChange={e=>setVariant(e.target.value)}><option value="">Primeira disponível</option>{variants.map((v:any)=><option key={v} value={v}>{v}</option>)}</select></label>}
        <label className="field"><span>Medida</span><select value={dimension} onChange={e=>setDimension(e.target.value)}><option value="">Padrão / primeira disponível</option>{dimensionLabels.map((d:any)=><option key={d} value={d}>{d}</option>)}</select></label>
        <label className="field"><span>Grupo de revestimento</span><select value={group} onChange={e=>setGroup(e.target.value)}><option value="">Primeiro disponível</option>{groups.map((g:any)=><option key={g} value={g}>{g}</option>)}</select></label>
        <label className="field"><span>Revestimento / acabamento escolhido</span><input value={finish} onChange={e=>setFinish(e.target.value)} placeholder="Ex.: Bouclé Areia TC-3281"/></label>
      </section>
      <section className="panel pad salesPricePanel"><h3>Valor da proposta</h3><div className="tablePrice"><span>Preço de tabela</span><strong>{money(tablePrice)}</strong></div><label className="field saleField"><span>Preço da proposta</span><input type="number" step="0.01" value={sale} onChange={e=>setSale(e.target.value)}/></label><div className={`salesPolicy ${policyStatus}`}><span className="policyDot"/><div><b>{policyMessage}</b><small>{policyStatus==='bad'?'Ajuste o valor ou solicite aprovação antes de fechar.':'A política interna continua oculta nesta tela.'}</small></div></div></section>
    </div>}

    {tab==='internal'&&canSeeInternal&&<div className="internalMode"><div className="internalWarning">Área restrita · não utilizar diante do cliente.</div><div className="internalKpis"><article><span>Custo efetivo</span><strong>{money(cost)}</strong></article><article><span>Markup da tabela</span><strong>{tableMarkup?tableMarkup.toFixed(2):'—'}</strong></article><article><span>Markup alvo</span><strong>{targetMarkup?targetMarkup.toFixed(2):'—'}</strong></article><article><span>Markup mínimo</span><strong>{minMarkup?minMarkup.toFixed(2):'—'}</strong></article><article><span>Markup realizado</span><strong>{realizedMarkup?realizedMarkup.toFixed(3):'—'}</strong></article><article><span>Margem bruta estimada</span><strong>{margin?margin.toFixed(1)+'%':'—'}</strong></article></div><div className={`health ${policyStatus}`}><small>{policyMessage}</small></div></div>}

    {tab==='source'&&canSeeInternal&&<div className="productSource">
      <div className="sourceHero"><div><span className="eyebrow">RASTREABILIDADE</span><h3>Origem permanente do produto</h3><p>Cada preço mantém vínculo com tabela, código, variação, medida e grupo.</p></div><input className="search" value={sourceSearch} onChange={e=>setSourceSearch(e.target.value)} placeholder="Buscar código, variação, medida…"/></div>
      <div className="sourceKpis"><article><span>Códigos fornecedor</span><strong>{codes.length||1}</strong><small>{codes.map((c:any)=>c.product_code).join(' · ')||product.manufacturer_code||'—'}</small></article><article><span>Variações</span><strong>{variants.length}</strong><small>{variants.slice(0,4).join(' · ')||'—'}{variants.length>4?'…':''}</small></article><article><span>Medidas</span><strong>{dimensionLabels.length}</strong><small>{dimensionLabels.slice(0,5).join(' · ')||'—'}</small></article><article><span>Preços vinculados</span><strong>{entries.length}</strong><small>{groups.length} grupos de preço</small></article></div>
      {tables.length>0&&<div className="sourceDocs"><h4>Tabelas e parâmetros de origem</h4>{tables.map((table:any)=>{const doc=documents.find((d:any)=>d.id===table.source_document_id);return <div className="sourceDocRow" key={table.id}><button className="sourceDocOpen" onClick={()=>doc&&openDocument(doc)} disabled={!doc}><span>{table.name}</span><small>{table.price_basis==='cost'?'Tabela de custo':'Tabela de venda'} · {doc?'abrir original ↗':'original indisponível'}</small></button><label><span>Markup de referência</span><div><input inputMode="decimal" value={markupDraft[table.id]??''} onChange={e=>setMarkupDraft(m=>({...m,[table.id]:e.target.value}))} placeholder="Ex.: 1,90"/><button onClick={()=>saveReferenceMarkup(table)} disabled={savingMarkup===table.id}>{savingMarkup===table.id?'Salvando…':'Aplicar'}</button></div><small>{table.price_basis==='sale'?'Custo = venda ÷ markup':'Venda de referência = custo × markup'}</small></label></div>})}</div>}
      <div className="sourceTableWrap"><table className="sourceTable"><thead><tr><th>Código</th><th>Variação</th><th>Medida</th><th>Grupo</th><th>Preço origem</th><th>Custo</th><th>Markup ref.</th><th>Tabela</th></tr></thead><tbody>{filteredEntries.map((e:any)=><tr key={e.id}><td><b>{e.supplier_product_code||'—'}</b></td><td>{e.configuration?.variant_label||'—'}</td><td>{e.dimension_signature?.label||'—'}</td><td>{e.pricing_group||'—'}</td><td><b>{money(e.source_price??e.price_value)}</b></td><td>{money(e.cost_price)}</td><td>{e.price_tables?.reference_markup?Number(e.price_tables.reference_markup).toFixed(2):'—'}</td><td>{e.price_tables?.name||'—'}</td></tr>)}</tbody></table>{filteredEntries.length===0&&<div className="empty">Nenhum preço encontrado.</div>}</div>
    </div>}

    <div className="modalActions"><button onClick={onClose}>Fechar</button>{tab==='sales'&&<button className="primary" onClick={()=>navigator.clipboard?.writeText(`${product.name} | ${variant||safeEntry?.variant_label||'variação padrão'} | ${dimension||safeEntry?.dimension_label||'medida padrão'} | ${group||safeEntry?.pricing_group||'grupo padrão'} | ${finish||'acabamento a definir'} | ${money(saleN)}`)}>Copiar configuração para orçamento</button>}</div>
  </div></div>
}
