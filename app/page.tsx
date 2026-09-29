'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { groupProductProposals, norm, parseWorkbook } from '../lib/parser'
import { effectiveCost, money, pricingMetrics } from '../lib/pricing'

type View = 'dashboard'|'catalog'|'suppliers'|'reviews'
type SupplierTab = 'overview'|'products'|'files'|'terms'|'promotions'|'representatives'|'intelligence'

const DOC_TYPES = [
  ['price_table','Tabela de preços'],
  ['catalog','Catálogo'],
  ['finish_catalog','Catálogo de acabamentos'],
  ['technical_sheet','Ficha técnica'],
  ['commercial_terms','Condições comerciais'],
  ['promotion','Promoção'],
  ['other','Outro'],
]
const STATUS_LABEL:any={draft:'Rascunho',in_progress:'Em cadastro',in_review:'Em revisão',approved:'Aprovado',active:'Ativo',inactive:'Inativo',discontinued:'Descontinuado',archived:'Arquivado',review:'Revisão',processing:'Processando',error:'Erro',pending:'Pendente',applied:'Aplicado',rejected:'Rejeitado'}

function slugify(v:string){return norm(v).replace(/\s+/g,'-').slice(0,70)||`produto-${Date.now()}`}
function fmtDate(v:any){if(!v)return '—'; return new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString('pt-BR')}
function pct(v:any){return `${Math.round(Number(v||0)*100)}%`}
function cls(...x:any[]){return x.filter(Boolean).join(' ')}
function emptyToNull(v:any){return v===''?null:v}

export default function Home(){
  const supabase=useMemo(()=>getSupabase(),[])
  const [session,setSession]=useState<any>(null)
  const [profile,setProfile]=useState<any>(null)
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMessage,setAuthMessage]=useState('')
  const [view,setView]=useState<View>('dashboard')
  const [brands,setBrands]=useState<any[]>([])
  const [products,setProducts]=useState<any[]>([])
  const [documents,setDocuments]=useState<any[]>([])
  const [proposals,setProposals]=useState<any[]>([])
  const [loading,setLoading]=useState(true)
  const [selectedBrand,setSelectedBrand]=useState<any>(null)
  const [supplierTab,setSupplierTab]=useState<SupplierTab>('overview')
  const [selectedProduct,setSelectedProduct]=useState<any>(null)
  const [toast,setToast]=useState('')

  useEffect(()=>{
    if(!supabase)return
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)})
    const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>data.subscription.unsubscribe()
  },[supabase])

  useEffect(()=>{if(session)loadCore(); else {setProfile(null);setLoading(false)}},[session])

  function notify(v:string){setToast(v);setTimeout(()=>setToast(''),3500)}
  async function login(e:React.FormEvent){
    e.preventDefault(); if(!supabase)return
    setAuthMessage('Entrando...')
    const {error}=await supabase.auth.signInWithPassword({email,password})
    setAuthMessage(error?error.message:'')
  }
  async function loadCore(){
    if(!supabase||!session)return
    setLoading(true)
    const [p,b,pr,d,c]=await Promise.all([
      supabase.from('profiles').select('*').eq('user_id',session.user.id).maybeSingle(),
      supabase.from('brands').select('*').order('name'),
      supabase.from('products').select('*').order('updated_at',{ascending:false}).limit(1000),
      supabase.from('source_documents').select('*').order('created_at',{ascending:false}).limit(300),
      supabase.from('change_proposals').select('*').order('created_at',{ascending:false}).limit(500),
    ])
    setProfile(p.data); setBrands(b.data||[]); setProducts(pr.data||[]); setDocuments(d.data||[]); setProposals(c.data||[])
    setLoading(false)
  }

  if(loading&&!session)return <div className="boot">Carregando SB Product Brain…</div>
  if(!session)return <main className="login"><div className="loginCard"><div className="logo">SB</div><p className="eyebrow">GRUPO SB</p><h1>Product Brain</h1><p className="muted">Inteligência central de fornecedores, produtos, tabelas e regras comerciais.</p><form onSubmit={login}><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label><button className="primary">Entrar</button></form>{authMessage&&<p className="message">{authMessage}</p>}</div></main>

  const pending=proposals.filter(x=>x.status==='pending').length
  const pendingDocs=documents.filter(x=>['uploaded','processing','review','error'].includes(x.status)&&x.approval_status!=='approved').length
  const nav=(v:View,label:string,badge?:number)=><button className={cls('navBtn',view===v&&'on')} onClick={()=>{setView(v);setSelectedBrand(null);setSelectedProduct(null)}}>{label}{badge? <b>{badge}</b>:null}</button>

  return <div className="shell">
    <aside>
      <div className="sideBrand"><div className="logo small">SB</div><div><strong>Product Brain</strong><small>Grupo SB</small></div></div>
      <nav>{nav('dashboard','Visão geral')}{nav('catalog','Catálogo')}{nav('suppliers','Fornecedores / Marcas')}{nav('reviews','Revisões',pending)}</nav>
      <div className="sideSection"><span>INTELIGÊNCIA</span><p>Astra Parser</p><small>{pendingDocs} arquivo(s) pedindo atenção</small></div>
      <div className="sideBottom"><small>{session.user.email}</small><span>{profile?.role||'usuário'}</span><button onClick={()=>supabase?.auth.signOut()}>Sair</button></div>
    </aside>
    <main className="content">
      {toast&&<div className="toast">{toast}</div>}
      {view==='dashboard'&&<Dashboard brands={brands} products={products} documents={documents} proposals={proposals} onGo={(v:View)=>setView(v)} />}
      {view==='catalog'&&<Catalog supabase={supabase} products={products} brands={brands} selected={selectedProduct} onSelect={setSelectedProduct} onRefresh={loadCore} notify={notify} />}
      {view==='suppliers'&&<Suppliers supabase={supabase} brands={brands} products={products} documents={documents} proposals={proposals} selected={selectedBrand} onSelect={b=>{setSelectedBrand(b);setSupplierTab('overview')}} tab={supplierTab} setTab={setSupplierTab} onRefresh={async()=>{await loadCore(); if(selectedBrand){const {data}=await supabase!.from('brands').select('*').eq('id',selectedBrand.id).single();setSelectedBrand(data)}}} notify={notify} profile={profile} />}
      {view==='reviews'&&<ReviewCenter supabase={supabase} proposals={proposals} documents={documents} brands={brands} onRefresh={loadCore} notify={notify} />}
    </main>
  </div>
}

function Dashboard({brands,products,documents,proposals,onGo}:any){
  const pending=proposals.filter((x:any)=>x.status==='pending')
  const reviewDocs=documents.filter((x:any)=>['review','error','processing'].includes(x.status))
  const activePrompts=reviewDocs.slice(0,5)
  return <>
    <PageHeader eyebrow="PRODUCT BRAIN" title="Visão geral" desc="O que precisa da sua atenção agora." />
    <div className="kpis">
      <Kpi label="Produtos" value={products.length} sub={`${products.filter((p:any)=>p.status==='active').length} ativos`} />
      <Kpi label="Fornecedores" value={brands.length} sub="fichas cadastradas" />
      <Kpi label="Propostas da IA" value={pending.length} sub="aguardando decisão" alert={pending.length>0}/>
      <Kpi label="Arquivos" value={reviewDocs.length} sub="em revisão / erro" alert={reviewDocs.length>0}/>
    </div>
    <div className="dashGrid">
      <section className="panel"><div className="panelHead"><div><h2>Fila de atenção</h2><p>Prioridades antes de o dado virar oficial.</p></div><button onClick={()=>onGo('reviews')}>Ver revisões</button></div>
        <div className="attentionList">
          {pending.slice(0,6).map((p:any)=><div className="attention" key={p.id}><span className="dot amber"></span><div><strong>{p.proposed_data?.name||p.entity_type}</strong><small>{p.action==='create'?'Novo cadastro sugerido':'Atualização sugerida'} · confiança {pct(p.confidence)}</small></div></div>)}
          {!pending.length&&<Empty text="Nenhuma proposta pendente."/>}
        </div>
      </section>
      <section className="panel"><div className="panelHead"><div><h2>Importações recentes</h2><p>Arquivos que ainda precisam concluir o ciclo.</p></div></div>
        <div className="attentionList">
          {activePrompts.map((d:any)=><div className="attention" key={d.id}><span className={cls('dot',d.status==='error'?'red':'blue')}></span><div><strong>{d.filename}</strong><small>{STATUS_LABEL[d.status]||d.status} · {fmtDate(d.created_at)}</small></div></div>)}
          {!activePrompts.length&&<Empty text="Nenhum arquivo pendente."/>}
        </div>
      </section>
    </div>
  </>
}

function Kpi({label,value,sub,alert}:any){return <article className={cls('kpi',alert&&'alert')}><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>}
function PageHeader({eyebrow,title,desc,action}:any){return <header className="pageHeader"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{desc}</p></div>{action}</header>}
function Empty({text}:any){return <div className="empty">{text}</div>}
function Badge({children,tone='gray'}:any){return <span className={`badge ${tone}`}>{children}</span>}

function Catalog({supabase,products,brands,selected,onSelect,onRefresh,notify}:any){
  const [q,setQ]=useState('')
  const [status,setStatus]=useState('')
  const [newOpen,setNewOpen]=useState(false)
  const filtered=products.filter((p:any)=>(!q||norm(`${p.name} ${p.public_id||''} ${p.manufacturer_code||''}`).includes(norm(q)))&&(!status||p.status===status))
  if(selected)return <ProductDetail supabase={supabase} product={selected} brands={brands} onBack={()=>onSelect(null)} onRefresh={async()=>{await onRefresh();const {data}=await supabase.from('products').select('*').eq('id',selected.id).single();onSelect(data)}} notify={notify}/>
  async function createProduct(e:any){
    e.preventDefault();const fd=new FormData(e.currentTarget);const name=String(fd.get('name')||'');if(!name)return
    const {error}=await supabase.from('products').insert({name,slug:`${slugify(name)}-${Date.now().toString().slice(-5)}`,brand_id:emptyToNull(fd.get('brand_id')),product_type:emptyToNull(fd.get('product_type')),manufacturer_code:emptyToNull(fd.get('manufacturer_code')),status:'draft'})
    if(error)return notify(error.message);setNewOpen(false);notify('Produto criado.');onRefresh()
  }
  return <>
    <PageHeader eyebrow="CATÁLOGO" title="Produtos" desc="Cadastro canônico: um produto, várias configurações e tabelas." action={<button className="primary" onClick={()=>setNewOpen(true)}>+ Novo produto</button>}/>
    <div className="filters"><input placeholder="Buscar produto, ID ou código..." value={q} onChange={e=>setQ(e.target.value)}/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os status</option><option value="draft">Rascunho</option><option value="in_review">Em revisão</option><option value="active">Ativo</option><option value="inactive">Inativo</option></select></div>
    <section className="panel"><div className="panelHead"><h2>{filtered.length} produtos</h2></div><div className="dataTable">
      {filtered.map((p:any)=><button className="dataRow productRow" key={p.id} onClick={()=>onSelect(p)}><div><strong>{p.name}</strong><small>{p.public_id||'ID em geração'} {p.manufacturer_code?`· cód. ${p.manufacturer_code}`:''}</small></div><span>{brands.find((b:any)=>b.id===p.brand_id)?.name||'Sem fornecedor'}</span><Badge tone={p.status==='active'?'green':p.status==='in_review'?'amber':'gray'}>{STATUS_LABEL[p.status]||p.status}</Badge><b>→</b></button>)}
    </div></section>
    {newOpen&&<Modal title="Novo produto" onClose={()=>setNewOpen(false)}><form className="formGrid" onSubmit={createProduct}><Field label="Nome"><input name="name" required/></Field><Field label="Fornecedor / Marca"><select name="brand_id"><option value="">—</option>{brands.map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><Field label="Tipo"><input name="product_type" placeholder="Sofá, mesa, cadeira..."/></Field><Field label="Código do fabricante"><input name="manufacturer_code"/></Field><div className="modalActions"><button type="button" onClick={()=>setNewOpen(false)}>Cancelar</button><button className="primary">Criar</button></div></form></Modal>}
  </>
}

function ProductDetail({supabase,product,brands,onBack,onRefresh,notify}:any){
  const [dims,setDims]=useState<any[]>([]),[prices,setPrices]=useState<any[]>([]),[terms,setTerms]=useState<any>(null),[options,setOptions]=useState<any[]>([])
  const [sale,setSale]=useState<number>(0),[selectedPrice,setSelectedPrice]=useState<any>(null)
  useEffect(()=>{load()},[product.id])
  async function load(){
    const [d,p,o,t]=await Promise.all([
      supabase.from('product_dimensions').select('*').eq('product_id',product.id).order('sort_order'),
      supabase.from('price_entries').select('*,price_tables(*)').eq('product_id',product.id).order('created_at',{ascending:false}).limit(200),
      supabase.from('product_option_groups').select('*,option_groups(*,option_values(*))').eq('product_id',product.id).order('sort_order'),
      product.brand_id?supabase.from('supplier_commercial_terms').select('*').eq('brand_id',product.brand_id).eq('status','approved').order('valid_from',{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null}),
    ])
    setDims(d.data||[]);setPrices(p.data||[]);setOptions(o.data||[]);setTerms(t.data)
    const cost=(p.data||[]).find((x:any)=>x.price_basis==='cost')
    if(cost){setSelectedPrice(cost);const ec=effectiveCost(Number(cost.source_price||cost.price_value||cost.cost_price),cost.price_tables?.ipi_mode,cost.price_tables?.ipi_rate,cost.price_tables?.freight_mode,cost.price_tables?.freight_value);setSale(ec*Number(t.data?.target_markup||1.9))}
  }
  const ec=selectedPrice?effectiveCost(Number(selectedPrice.source_price||selectedPrice.price_value||selectedPrice.cost_price),selectedPrice.price_tables?.ipi_mode,selectedPrice.price_tables?.ipi_rate,selectedPrice.price_tables?.freight_mode,selectedPrice.price_tables?.freight_value):0
  const metrics=pricingMetrics(ec,sale,terms?.target_markup,terms?.minimum_markup)
  async function saveCore(e:any){
    e.preventDefault();const fd=new FormData(e.currentTarget)
    const {error}=await supabase.from('products').update({name:fd.get('name'),product_type:emptyToNull(fd.get('product_type')),manufacturer_code:emptyToNull(fd.get('manufacturer_code')),status:fd.get('status'),short_description:emptyToNull(fd.get('short_description'))}).eq('id',product.id)
    if(error)return notify(error.message);notify('Produto atualizado.');onRefresh()
  }
  return <>
    <button className="back" onClick={onBack}>← Catálogo</button>
    <PageHeader eyebrow={product.public_id||'PRODUTO'} title={product.name} desc={`${brands.find((b:any)=>b.id===product.brand_id)?.name||'Sem fornecedor'} · ${product.product_type||'sem tipo'}`}/>
    <div className="productLayout">
      <div className="stack">
        <section className="panel pad"><h2>Ficha principal</h2><form className="formGrid" onSubmit={saveCore}><Field label="Nome"><input name="name" defaultValue={product.name}/></Field><Field label="Tipo"><input name="product_type" defaultValue={product.product_type||''}/></Field><Field label="Código fabricante"><input name="manufacturer_code" defaultValue={product.manufacturer_code||''}/></Field><Field label="Status"><select name="status" defaultValue={product.status}><option value="draft">Rascunho</option><option value="in_review">Em revisão</option><option value="approved">Aprovado</option><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="discontinued">Descontinuado</option></select></Field><Field label="Descrição curta" wide><textarea name="short_description" defaultValue={product.short_description||''}/></Field><div className="formActions"><button className="primary">Salvar ficha</button></div></form></section>
        <section className="panel pad"><div className="sectionTitle"><div><h2>Configurações</h2><p>Medidas e grupos aceitos pelo produto.</p></div></div>
          <div className="chips">{dims.map((d:any)=><span className="chip" key={d.id}>{d.label}</span>)}{!dims.length&&<Empty text="Nenhuma medida estruturada ainda."/>}</div>
          {options.map((o:any)=><div className="optionBlock" key={o.option_group_id}><strong>{o.option_groups?.name}</strong><div className="chips">{(o.option_groups?.option_values||[]).map((v:any)=><span className="chip soft" key={v.id}>{v.name}</span>)}</div></div>)}
        </section>
        <section className="panel pad"><h2>Histórico de preços</h2><div className="simpleTable"><div className="simpleHead"><span>Origem</span><span>Configuração</span><span>Base</span><span>Valor</span></div>{prices.slice(0,30).map((p:any)=><button className={cls('simpleRow',selectedPrice?.id===p.id&&'selected')} key={p.id} onClick={()=>{setSelectedPrice(p);const c=effectiveCost(Number(p.source_price||p.price_value||p.cost_price),p.price_tables?.ipi_mode,p.price_tables?.ipi_rate,p.price_tables?.freight_mode,p.price_tables?.freight_value);setSale(c*Number(terms?.target_markup||1.9))}}><span>{p.price_tables?.name||'Tabela'}</span><span>{p.dimension_signature?.label||'—'} {p.pricing_group?`· ${p.pricing_group}`:''}</span><Badge tone={p.price_basis==='cost'?'blue':'green'}>{p.price_basis==='cost'?'Custo':'Venda'}</Badge><strong>{money(p.source_price||p.price_value||p.cost_price||p.suggested_retail)}</strong></button>)}{!prices.length&&<Empty text="Nenhum preço aprovado ainda."/>}</div></section>
      </div>
      <aside className="pricingCard">
        <p className="eyebrow">SIMULADOR COMERCIAL</p><h2>Preço da venda</h2>
        {!selectedPrice?<Empty text="Selecione ou importe uma tabela de custo para simular."/>:<>
          <div className="metricLine"><span>Preço origem</span><b>{money(selectedPrice.source_price||selectedPrice.price_value||selectedPrice.cost_price)}</b></div>
          <div className="metricLine"><span>IPI</span><b>{selectedPrice.price_tables?.ipi_mode||'—'} {selectedPrice.price_tables?.ipi_rate?`${selectedPrice.price_tables.ipi_rate}%`:''}</b></div>
          <div className="metricLine"><span>Frete</span><b>{selectedPrice.price_tables?.freight_mode||'—'} {selectedPrice.price_tables?.freight_value||''}</b></div>
          <div className="metricLine total"><span>Custo efetivo</span><b>{money(ec)}</b></div>
          <label className="saleInput">Preço da proposta<input type="number" step="0.01" value={sale||''} onChange={e=>setSale(Number(e.target.value))}/></label>
          <div className="pricingMetrics"><div><span>Markup</span><strong>{metrics.markup.toFixed(2)}</strong></div><div><span>Margem bruta</span><strong>{(metrics.margin*100).toFixed(1)}%</strong></div><div><span>Preço sugerido</span><strong>{money(metrics.suggested)}</strong></div><div><span>Desconto</span><strong>{(metrics.discount*100).toFixed(1)}%</strong></div></div>
          <div className={cls('health',metrics.belowMinimum?'bad':metrics.markup<(Number(terms?.target_markup)||1.9)?'warn':'good')}>{metrics.belowMinimum?'Abaixo do markup mínimo':metrics.markup<(Number(terms?.target_markup)||1.9)?'Abaixo da meta, mas dentro da faixa':'Margem saudável'}</div>
          <small className="muted">O valor da proposta é livre. O sistema mostra o impacto comercial sem travar a negociação.</small>
        </>}
      </aside>
    </div>
  </>
}

function Suppliers({supabase,brands,products,documents,proposals,selected,onSelect,tab,setTab,onRefresh,notify,profile}:any){
  const [q,setQ]=useState(''),[newOpen,setNewOpen]=useState(false)
  if(selected)return <SupplierDetail supabase={supabase} brand={selected} products={products.filter((p:any)=>p.brand_id===selected.id)} documents={documents.filter((d:any)=>d.brand_id===selected.id)} proposals={proposals.filter((p:any)=>p.brand_id===selected.id)} tab={tab} setTab={setTab} onBack={()=>onSelect(null)} onRefresh={onRefresh} notify={notify} profile={profile}/>
  const filtered=brands.filter((b:any)=>!q||norm(`${b.name} ${b.legal_name||''} ${b.tax_id||''}`).includes(norm(q)))
  async function createBrand(e:any){
    e.preventDefault();const fd=new FormData(e.currentTarget);const name=String(fd.get('name')||'')
    const {error}=await supabase.from('brands').insert({name,slug:`${slugify(name)}-${Date.now().toString().slice(-4)}`,legal_name:emptyToNull(fd.get('legal_name')),tax_id:emptyToNull(fd.get('tax_id')),website_url:emptyToNull(fd.get('website_url')),is_active:true})
    if(error)return notify(error.message);setNewOpen(false);notify('Fornecedor criado.');onRefresh()
  }
  return <>
    <PageHeader eyebrow="ESTRUTURA" title="Fornecedores / Marcas" desc="A fonte de verdade de produtos, tabelas, regras e documentos." action={<button className="primary" onClick={()=>setNewOpen(true)}>+ Novo fornecedor</button>}/>
    <div className="filters"><input placeholder="Buscar fornecedor..." value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="supplierGrid">{filtered.map((b:any)=>{const docs=documents.filter((d:any)=>d.brand_id===b.id), pend=proposals.filter((p:any)=>p.brand_id===b.id&&p.status==='pending').length;return <button className="supplierCard" key={b.id} onClick={()=>onSelect(b)}><div className="supplierTop"><div className="brandInitial">{b.name.slice(0,2).toUpperCase()}</div>{pend>0&&<Badge tone="amber">{pend} revisão</Badge>}</div><h2>{b.name}</h2><p>{products.filter((p:any)=>p.brand_id===b.id).length} produtos · {docs.length} arquivos</p><span>Abrir ficha →</span></button>})}</div>
    {newOpen&&<Modal title="Novo fornecedor / marca" onClose={()=>setNewOpen(false)}><form className="formGrid" onSubmit={createBrand}><Field label="Nome"><input name="name" required/></Field><Field label="Razão social"><input name="legal_name"/></Field><Field label="CNPJ"><input name="tax_id"/></Field><Field label="Site"><input name="website_url"/></Field><div className="modalActions"><button type="button" onClick={()=>setNewOpen(false)}>Cancelar</button><button className="primary">Criar fornecedor</button></div></form></Modal>}
  </>
}

function SupplierDetail({supabase,brand,products,documents,proposals,tab,setTab,onBack,onRefresh,notify,profile}:any){
  const tabs:[SupplierTab,string][]=[['overview','Visão Geral'],['products','Produtos'],['files','Arquivos'],['terms','Condições Comerciais'],['promotions','Promoções'],['representatives','Representantes'],['intelligence','Inteligência']]
  return <>
    <button className="back" onClick={onBack}>← Fornecedores</button>
    <PageHeader eyebrow="FORNECEDOR / MARCA" title={brand.name} desc={`${products.length} produtos · ${documents.length} arquivos · ${proposals.filter((p:any)=>p.status==='pending').length} propostas pendentes`}/>
    <div className="tabs">{tabs.map(([k,l])=><button className={tab===k?'on':''} key={k} onClick={()=>setTab(k)}>{l}{k==='intelligence'&&proposals.filter((p:any)=>p.status==='pending').length>0?<b>{proposals.filter((p:any)=>p.status==='pending').length}</b>:null}</button>)}</div>
    {tab==='overview'&&<SupplierOverview supabase={supabase} brand={brand} onRefresh={onRefresh} notify={notify}/>} 
    {tab==='products'&&<SupplierProducts products={products}/>} 
    {tab==='files'&&<SupplierFiles supabase={supabase} brand={brand} documents={documents} products={products} onRefresh={onRefresh} notify={notify} profile={profile}/>} 
    {tab==='terms'&&<SupplierTerms supabase={supabase} brand={brand} notify={notify}/>} 
    {tab==='promotions'&&<SupplierPromotions supabase={supabase} brand={brand} notify={notify}/>} 
    {tab==='representatives'&&<SupplierRepresentatives supabase={supabase} brand={brand} notify={notify}/>} 
    {tab==='intelligence'&&<SupplierIntelligence supabase={supabase} brand={brand} proposals={proposals} documents={documents} onRefresh={onRefresh} notify={notify}/>} 
  </>
}

function SupplierOverview({supabase,brand,onRefresh,notify}:any){
  async function save(e:any){e.preventDefault();const fd=new FormData(e.currentTarget);const payload:any={};['name','legal_name','tax_id','internal_code','website_url','email','phone','city','state','country','notes'].forEach(k=>payload[k]=emptyToNull(fd.get(k)));const {error}=await supabase.from('brands').update(payload).eq('id',brand.id);if(error)return notify(error.message);notify('Ficha atualizada.');onRefresh()}
  return <section className="panel pad"><div className="sectionTitle"><div><h2>Cadastro do fornecedor</h2><p>Identificação institucional e contato geral.</p></div></div><form className="formGrid" onSubmit={save}><Field label="Nome"><input name="name" defaultValue={brand.name}/></Field><Field label="Razão social"><input name="legal_name" defaultValue={brand.legal_name||''}/></Field><Field label="CNPJ"><input name="tax_id" defaultValue={brand.tax_id||''}/></Field><Field label="Código interno"><input name="internal_code" defaultValue={brand.internal_code||''}/></Field><Field label="Site"><input name="website_url" defaultValue={brand.website_url||''}/></Field><Field label="E-mail"><input name="email" defaultValue={brand.email||''}/></Field><Field label="Telefone"><input name="phone" defaultValue={brand.phone||''}/></Field><Field label="Cidade"><input name="city" defaultValue={brand.city||''}/></Field><Field label="Estado"><input name="state" defaultValue={brand.state||''}/></Field><Field label="País"><input name="country" defaultValue={brand.country||'Brasil'}/></Field><Field label="Observações" wide><textarea name="notes" defaultValue={brand.notes||''}/></Field><div className="formActions"><button className="primary">Salvar ficha</button></div></form></section>
}

function SupplierProducts({products}:any){return <section className="panel"><div className="panelHead"><h2>{products.length} produtos</h2></div><div className="dataTable">{products.map((p:any)=><div className="dataRow" key={p.id}><div><strong>{p.name}</strong><small>{p.public_id||'—'} {p.manufacturer_code?`· ${p.manufacturer_code}`:''}</small></div><span>{p.product_type||'—'}</span><Badge tone={p.status==='active'?'green':'gray'}>{STATUS_LABEL[p.status]||p.status}</Badge></div>)}{!products.length&&<Empty text="Os produtos podem nascer automaticamente das tabelas aprovadas."/>}</div></section>}

function SupplierFiles({supabase,brand,documents,products,onRefresh,notify}:any){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[selected,setSelected]=useState<any>(null),[detail,setDetail]=useState<any>(null)
  useEffect(()=>{if(selected)loadDetail(selected)},[selected?.id])
  async function loadDetail(doc:any){
    const {data:jobs}=await supabase.from('ingestion_jobs').select('*').eq('source_document_id',doc.id).order('created_at',{ascending:false}).limit(5)
    const job=jobs?.[0]
    let rows:any[]=[]
    if(job){const r=await supabase.from('extraction_rows').select('*').eq('job_id',job.id).order('row_index').limit(80);rows=r.data||[]}
    const pp=await supabase.from('change_proposals').select('*').eq('source_document_id',doc.id).order('created_at')
    setDetail({jobs:jobs||[],job,rows,proposals:pp.data||[]})
  }
  async function upload(e:any){
    e.preventDefault();if(busy)return;setBusy(true)
    try{
      const fd=new FormData(e.currentTarget), file=fd.get('file') as File
      if(!file?.name)throw new Error('Selecione um arquivo.')
      const docType=String(fd.get('document_type')),priceBasis=docType==='price_table'?String(fd.get('price_basis')||'cost'):null
      const safe=file.name.replace(/[^\w.\-]+/g,'_'),path=`${brand.id}/${Date.now()}-${safe}`
      const up=await supabase.storage.from('supplier-tables').upload(path,file,{upsert:false,contentType:file.type||undefined})
      if(up.error)throw up.error
      const {data:{user}}=await supabase.auth.getUser()
      const payload:any={brand_id:brand.id,document_type:docType,filename:file.name,storage_bucket:'supplier-tables',storage_path:path,mime_type:file.type||null,file_size:file.size,status:'processing',uploaded_by:user?.id||null,
        price_basis:priceBasis,ipi_mode:String(fd.get('ipi_mode')||'unknown'),ipi_rate:emptyToNull(fd.get('ipi_rate')),freight_mode:String(fd.get('freight_mode')||'unknown'),freight_value:emptyToNull(fd.get('freight_value')),valid_from:emptyToNull(fd.get('valid_from')),valid_until:emptyToNull(fd.get('valid_until')),processing_instructions:emptyToNull(fd.get('instructions')),approval_status:'pending',
        commercial_context:{price_basis:priceBasis,ipi_mode:fd.get('ipi_mode'),ipi_rate:emptyToNull(fd.get('ipi_rate')),freight_mode:fd.get('freight_mode'),freight_value:emptyToNull(fd.get('freight_value'))}}
      const di=await supabase.from('source_documents').insert(payload).select().single();if(di.error)throw di.error
      const ji=await supabase.from('ingestion_jobs').insert({source_document_id:di.data.id,status:'processing',parser_type:'astra_adaptive_v1',started_at:new Date().toISOString(),created_by:user?.id||null,metadata:{document_type:docType,price_basis:priceBasis}}).select().single();if(ji.error)throw ji.error
      const ext=file.name.split('.').pop()?.toLowerCase()
      if(!['xlsx','xls','csv'].includes(ext||'')){
        await supabase.from('ingestion_jobs').update({status:'review',completed_at:new Date().toISOString(),error_message:'Arquivo armazenado. Leitura estruturada automática desta versão é aplicada a Excel/CSV; este documento segue para revisão documental.'}).eq('id',ji.data.id)
        await supabase.from('source_documents').update({status:'review',approval_status:'review'}).eq('id',di.data.id)
        notify('Arquivo armazenado e enviado para revisão documental.');setOpen(false);await onRefresh();return
      }
      await processSpreadsheet(file,di.data,ji.data,priceBasis)
      notify('Tabela interpretada. Revise as propostas antes de aprovar.');setOpen(false);await onRefresh()
    }catch(err:any){notify(err.message||String(err))}finally{setBusy(false)}
  }
  async function processSpreadsheet(file:File,doc:any,job:any,priceBasis:string|null){
    const ai=await supabase.from('supplier_ai_profiles').select('*').eq('brand_id',brand.id).eq('document_type',doc.document_type).eq('is_active',true).order('version',{ascending:false}).limit(1).maybeSingle()
    const result=await parseWorkbook(file,ai.data?.learned_mapping||{},priceBasis)
    const codes=await supabase.from('product_brand_codes').select('*').eq('brand_id',brand.id)
    const prodByCode=new Map((codes.data||[]).map((x:any)=>[norm(x.product_code),x.product_id]))
    const prodByName=new Map(products.map((x:any)=>[norm(x.name),x.id]))
    const rows=result.rows.map(r=>({...r,job_id:job.id,product_id:prodByCode.get(norm(r.supplier_product_code||''))||prodByName.get(norm(r.product_name_raw||''))||null,cost_price:priceBasis==='cost'?r.price_value:null}))
    for(let i=0;i<rows.length;i+=300){const ins=await supabase.from('extraction_rows').insert(rows.slice(i,i+300));if(ins.error)throw ins.error}
    const groups=groupProductProposals(rows)
    const proposalsPayload=groups.map(g=>{
      const target=prodByCode.get(norm(g.code||''))||prodByName.get(norm(g.name))||null
      return {job_id:job.id,source_document_id:doc.id,brand_id:brand.id,entity_type:'product',action:target?'update':'create',target_id:target,proposed_data:g,current_data:{},source_locator:{document:doc.filename},dependencies:[],confidence:g.confidence,status:'pending'}
    })
    for(let i=0;i<proposalsPayload.length;i+=200){const ins=await supabase.from('change_proposals').insert(proposalsPayload.slice(i,i+200));if(ins.error)throw ins.error}
    const profilePayload={brand_id:brand.id,document_type:doc.document_type,profile_name:'Astra adaptativo',version:(ai.data?.version||0)+1,fingerprints:result.fingerprint,learned_mapping:result.mapping,learned_rules:ai.data?.learned_rules||{},approved_examples:ai.data?.approved_examples||[],confidence:result.summary.average_confidence||0,successful_runs:ai.data?.successful_runs||0,is_active:true,last_used_at:new Date().toISOString()}
    if(ai.data)await supabase.from('supplier_ai_profiles').update({...profilePayload,version:ai.data.version}).eq('id',ai.data.id)
    else await supabase.from('supplier_ai_profiles').insert({...profilePayload,version:1})
    await supabase.from('ingestion_jobs').update({status:'review',completed_at:new Date().toISOString(),total_rows:rows.length,matched_rows:rows.filter(r=>r.product_id).length,review_rows:rows.length,extraction_summary:result.summary,metadata:{document_type:doc.document_type,price_basis:priceBasis,proposal_count:groups.length}}).eq('id',job.id)
    await supabase.from('source_documents').update({status:'review',approval_status:'review'}).eq('id',doc.id)
  }
  async function reprocess(doc:any){
    setBusy(true)
    try{
      const dl=await supabase.storage.from('supplier-tables').download(doc.storage_path);if(dl.error)throw dl.error
      const ext=doc.filename.split('.').pop()?.toLowerCase();if(!['xlsx','xls','csv'].includes(ext||''))throw new Error('Reprocessamento automático disponível para Excel/CSV.')
      const file=new File([dl.data],doc.filename,{type:doc.mime_type||dl.data.type})
      const {data:{user}}=await supabase.auth.getUser()
      const ji=await supabase.from('ingestion_jobs').insert({source_document_id:doc.id,status:'processing',parser_type:'astra_adaptive_v1_reprocess',started_at:new Date().toISOString(),created_by:user?.id||null,metadata:{reprocess:true}}).select().single();if(ji.error)throw ji.error
      await supabase.from('source_documents').update({status:'processing'}).eq('id',doc.id)
      await processSpreadsheet(file,doc,ji.data,doc.price_basis)
      notify('Reprocessamento concluído.');await onRefresh();await loadDetail(doc)
    }catch(e:any){notify(e.message||String(e))}finally{setBusy(false)}
  }
  async function openFile(doc:any){const r=await supabase.storage.from('supplier-tables').createSignedUrl(doc.storage_path,300);if(r.error)return notify(r.error.message);window.open(r.data.signedUrl,'_blank')}
  return <>
    <div className="twoCol">
      <section className="panel"><div className="panelHead"><div><h2>Central de arquivos</h2><p>Tabelas, catálogos, acabamentos e documentos comerciais.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Importar arquivo</button></div>
        <div className="docList">{documents.map((d:any)=><button key={d.id} className={cls('docRow',selected?.id===d.id&&'selected')} onClick={()=>setSelected(d)}><div className="fileIcon">{d.filename.split('.').pop()?.toUpperCase()}</div><div><strong>{d.filename}</strong><small>{DOC_TYPES.find(x=>x[0]===d.document_type)?.[1]||d.document_type} · {fmtDate(d.created_at)}</small></div><Badge tone={d.status==='error'?'red':d.status==='review'?'amber':d.status==='approved'?'green':'blue'}>{STATUS_LABEL[d.status]||d.status}</Badge></button>)}{!documents.length&&<Empty text="Nenhum arquivo ainda."/>}</div>
      </section>
      <section className="panel pad detailPane">{!selected?<Empty text="Selecione um arquivo para ver a interpretação."/>:!detail?<Empty text="Carregando…"/>:<><div className="sectionTitle"><div><p className="eyebrow">IMPORTAÇÃO</p><h2>{selected.filename}</h2><div className="chips"><Badge tone={selected.status==='error'?'red':selected.status==='review'?'amber':'blue'}>{STATUS_LABEL[selected.status]||selected.status}</Badge>{selected.price_basis&&<Badge>{selected.price_basis==='cost'?'Tabela de custo':'Tabela de venda'}</Badge>}<span className="chip">IPI: {selected.ipi_mode}</span><span className="chip">Frete: {selected.freight_mode}</span></div></div></div>
        <div className="fileActions"><button onClick={()=>openFile(selected)}>Abrir original</button>{['error','review'].includes(selected.status)&&<button disabled={busy} onClick={()=>reprocess(selected)}>Reprocessar</button>}</div>
        {detail.job&&<div className="miniKpis"><div><span>Linhas</span><b>{detail.job.total_rows||0}</b></div><div><span>Produtos ligados</span><b>{detail.job.matched_rows||0}</b></div><div><span>Propostas</span><b>{detail.proposals.length}</b></div></div>}
        {detail.job?.error_message&&<div className="notice">{detail.job.error_message}</div>}
        <h3>Amostra da leitura</h3><div className="miniTable">{detail.rows.slice(0,12).map((r:any)=><div key={r.id}><span>{r.sheet_name} #{r.row_index}</span><strong>{r.product_name_raw||r.supplier_product_code||'—'}</strong><span>{r.dimension_label||'—'}</span><span>{r.pricing_group||'—'}</span><b>{money(r.price_value||r.cost_price)}</b></div>)}{!detail.rows.length&&<Empty text="Sem linhas estruturadas neste arquivo."/>}</div>
      </>}</section>
    </div>
    {open&&<Modal title={`Importar para ${brand.name}`} onClose={()=>setOpen(false)} wide><form className="formGrid" onSubmit={upload}><Field label="Arquivo" wide><input type="file" name="file" accept=".xlsx,.xls,.csv,.pdf" required/></Field><Field label="Tipo de documento"><select name="document_type" defaultValue="price_table">{DOC_TYPES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></Field><Field label="Tabela"><select name="price_basis" defaultValue="cost"><option value="cost">Custo</option><option value="sale">Venda</option></select></Field><Field label="IPI"><select name="ipi_mode" defaultValue="unknown"><option value="unknown">Não informado</option><option value="none">Não incide</option><option value="included">Já incluso</option><option value="additional">Acrescentar ao valor</option><option value="varies">Varia por produto</option></select></Field><Field label="IPI %"><input name="ipi_rate" type="number" step="0.01"/></Field><Field label="Frete"><select name="freight_mode" defaultValue="unknown"><option value="unknown">Não informado</option><option value="included">Incluso</option><option value="percentage">Acrescentar %</option><option value="fixed">Valor fixo</option><option value="fob">FOB / calcular depois</option><option value="varies">Varia</option></select></Field><Field label="Frete % / valor"><input name="freight_value" type="number" step="0.01"/></Field><Field label="Vigência inicial"><input name="valid_from" type="date"/></Field><Field label="Vigência final"><input name="valid_until" type="date"/></Field><Field label="Instruções para o Astra" wide><textarea name="instructions" placeholder="Ex.: abas válidas, exceções, como o fornecedor identifica grupos, observações..."/></Field><div className="modalActions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button disabled={busy} className="primary">{busy?'Interpretando…':'Enviar e interpretar'}</button></div></form></Modal>}
  </>
}

function SupplierTerms({supabase,brand,notify}:any){
  const [items,setItems]=useState<any[]>([]),[open,setOpen]=useState(false)
  useEffect(()=>{load()},[brand.id]);async function load(){const {data}=await supabase.from('supplier_commercial_terms').select('*').eq('brand_id',brand.id).order('created_at',{ascending:false});setItems(data||[])}
  async function save(e:any){e.preventDefault();const fd=new FormData(e.currentTarget);const {data:{user}}=await supabase.auth.getUser();const {error}=await supabase.from('supplier_commercial_terms').insert({brand_id:brand.id,valid_from:emptyToNull(fd.get('valid_from')),valid_until:emptyToNull(fd.get('valid_until')),target_markup:emptyToNull(fd.get('target_markup')),minimum_markup:emptyToNull(fd.get('minimum_markup')),payment_terms:emptyToNull(fd.get('payment_terms')),lead_time_min_days:emptyToNull(fd.get('lead_time_min_days')),lead_time_max_days:emptyToNull(fd.get('lead_time_max_days')),ipi_mode:fd.get('ipi_mode'),ipi_rate:emptyToNull(fd.get('ipi_rate')),freight_mode:fd.get('freight_mode'),freight_value:emptyToNull(fd.get('freight_value')),notes:emptyToNull(fd.get('notes')),status:'approved',created_by:user?.id,approved_by:user?.id,approved_at:new Date().toISOString()});if(error)return notify(error.message);setOpen(false);notify('Condição comercial registrada.');load()}
  return <section className="panel"><div className="panelHead"><div><h2>Condições comerciais</h2><p>Histórico versionado de margem, prazo, pagamento, IPI e frete.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Nova condição</button></div><div className="timeline">{items.map((x:any)=><article key={x.id}><div><Badge tone={x.status==='approved'?'green':'gray'}>{x.status}</Badge><strong>{x.target_markup?`Markup ${x.target_markup}`:'Sem markup'} {x.minimum_markup?`· mínimo ${x.minimum_markup}`:''}</strong><p>{x.payment_terms||'Condição de pagamento não informada'} · prazo {x.lead_time_min_days||'—'}–{x.lead_time_max_days||'—'} dias</p><small>IPI {x.ipi_mode} {x.ipi_rate?`${x.ipi_rate}%`:''} · Frete {x.freight_mode} {x.freight_value||''} · vigência {fmtDate(x.valid_from)} → {fmtDate(x.valid_until)}</small></div></article>)}{!items.length&&<Empty text="Cadastre a regra padrão deste fornecedor."/>}</div>
    {open&&<Modal title="Nova condição comercial" onClose={()=>setOpen(false)} wide><form className="formGrid" onSubmit={save}><Field label="Markup alvo"><input name="target_markup" type="number" step=".01" placeholder="1.90"/></Field><Field label="Markup mínimo"><input name="minimum_markup" type="number" step=".01" placeholder="1.70"/></Field><Field label="Pagamento"><input name="payment_terms" placeholder="30 / 60 / 90"/></Field><Field label="Prazo mínimo (dias)"><input name="lead_time_min_days" type="number"/></Field><Field label="Prazo máximo (dias)"><input name="lead_time_max_days" type="number"/></Field><Field label="IPI"><select name="ipi_mode"><option value="unknown">Não informado</option><option value="none">Não incide</option><option value="included">Incluso</option><option value="additional">Adicional</option><option value="varies">Varia</option></select></Field><Field label="IPI %"><input name="ipi_rate" type="number" step=".01"/></Field><Field label="Frete"><select name="freight_mode"><option value="unknown">Não informado</option><option value="included">Incluso</option><option value="percentage">Percentual</option><option value="fixed">Fixo</option><option value="fob">FOB</option><option value="varies">Varia</option></select></Field><Field label="Frete % / valor"><input name="freight_value" type="number" step=".01"/></Field><Field label="Válida de"><input name="valid_from" type="date"/></Field><Field label="Até"><input name="valid_until" type="date"/></Field><Field label="Observações" wide><textarea name="notes"/></Field><div className="modalActions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Salvar</button></div></form></Modal>}
  </section>
}

function SupplierPromotions({supabase,brand,notify}:any){
  const [items,setItems]=useState<any[]>([]),[open,setOpen]=useState(false);useEffect(()=>{load()},[brand.id]);async function load(){const {data}=await supabase.from('supplier_promotions').select('*').eq('brand_id',brand.id).order('valid_from',{ascending:false});setItems(data||[])}
  async function save(e:any){e.preventDefault();const fd=new FormData(e.currentTarget);const {data:{user}}=await supabase.auth.getUser();const discount=Number(fd.get('discount')||0);const {error}=await supabase.from('supplier_promotions').insert({brand_id:brand.id,name:fd.get('name'),description:emptyToNull(fd.get('description')),valid_from:emptyToNull(fd.get('valid_from')),valid_until:emptyToNull(fd.get('valid_until')),rules:{discount_percent:discount,scope:String(fd.get('scope')||'all')},status:'approved',created_by:user?.id,approved_by:user?.id,approved_at:new Date().toISOString()});if(error)return notify(error.message);setOpen(false);notify('Promoção registrada.');load()}
  return <section className="panel"><div className="panelHead"><div><h2>Promoções</h2><p>Promoção nunca sobrescreve a tabela-base.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Nova promoção</button></div><div className="promoGrid">{items.map((x:any)=><article className="promoCard" key={x.id}><div><Badge tone={new Date(x.valid_until||'2999-01-01')>=new Date()?'green':'gray'}>{new Date(x.valid_until||'2999-01-01')>=new Date()?'Vigente':'Encerrada'}</Badge><h3>{x.name}</h3><p>{x.description||'—'}</p></div><strong>{x.rules?.discount_percent?`-${x.rules.discount_percent}%`:'Regra especial'}</strong><small>{fmtDate(x.valid_from)} → {fmtDate(x.valid_until)}</small></article>)}{!items.length&&<Empty text="Nenhuma promoção cadastrada."/>}</div>
    {open&&<Modal title="Nova promoção" onClose={()=>setOpen(false)}><form className="formGrid" onSubmit={save}><Field label="Nome" wide><input name="name" required/></Field><Field label="Desconto %"><input name="discount" type="number" step=".01"/></Field><Field label="Escopo"><input name="scope" placeholder="Todos / coleção / produtos..."/></Field><Field label="Início"><input name="valid_from" type="date"/></Field><Field label="Fim"><input name="valid_until" type="date"/></Field><Field label="Descrição" wide><textarea name="description"/></Field><div className="modalActions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Salvar</button></div></form></Modal>}
  </section>
}

function SupplierRepresentatives({supabase,brand,notify}:any){
  const [items,setItems]=useState<any[]>([]),[open,setOpen]=useState(false);useEffect(()=>{load()},[brand.id]);async function load(){const {data}=await supabase.from('brand_representatives').select('*').eq('brand_id',brand.id).order('is_primary',{ascending:false});setItems(data||[])}
  async function save(e:any){e.preventDefault();const fd=new FormData(e.currentTarget);const {error}=await supabase.from('brand_representatives').insert({brand_id:brand.id,company_name:emptyToNull(fd.get('company_name')),contact_name:fd.get('contact_name'),email:emptyToNull(fd.get('email')),phone:emptyToNull(fd.get('phone')),whatsapp:emptyToNull(fd.get('whatsapp')),region:emptyToNull(fd.get('region')),is_primary:fd.get('is_primary')==='on',notes:emptyToNull(fd.get('notes'))});if(error)return notify(error.message);setOpen(false);notify('Representante adicionado.');load()}
  return <section className="panel"><div className="panelHead"><div><h2>Representantes</h2><p>Contatos comerciais ligados ao fornecedor.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Representante</button></div><div className="repGrid">{items.map((x:any)=><article className="repCard" key={x.id}><div className="avatar">{x.contact_name.slice(0,1)}</div><div><strong>{x.contact_name}</strong><small>{x.company_name||brand.name} {x.is_primary?'· principal':''}</small><p>{x.whatsapp||x.phone||'Sem telefone'} · {x.email||'sem e-mail'}</p><span>{x.region||'Região não definida'}</span></div></article>)}{!items.length&&<Empty text="Nenhum representante cadastrado."/>}</div>
    {open&&<Modal title="Novo representante" onClose={()=>setOpen(false)}><form className="formGrid" onSubmit={save}><Field label="Nome"><input name="contact_name" required/></Field><Field label="Empresa"><input name="company_name"/></Field><Field label="E-mail"><input name="email" type="email"/></Field><Field label="Telefone"><input name="phone"/></Field><Field label="WhatsApp"><input name="whatsapp"/></Field><Field label="Região"><input name="region"/></Field><Field label="Principal"><label className="check"><input name="is_primary" type="checkbox"/> contato principal</label></Field><Field label="Observações" wide><textarea name="notes"/></Field><div className="modalActions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Salvar</button></div></form></Modal>}
  </section>
}

function SupplierIntelligence({supabase,brand,proposals,documents,onRefresh,notify}:any){
  const [profiles,setProfiles]=useState<any[]>([]),[busy,setBusy]=useState('')
  useEffect(()=>{load()},[brand.id]);async function load(){const {data}=await supabase.from('supplier_ai_profiles').select('*').eq('brand_id',brand.id).order('updated_at',{ascending:false});setProfiles(data||[])}
  async function approve(p:any){setBusy(p.id);try{await applyProposal({supabase,proposal:p,brand,documents});notify('Proposta aplicada ao Product Brain.');await onRefresh();await load()}catch(e:any){notify(e.message||String(e))}finally{setBusy('')}}
  async function reject(p:any){const {data:{user}}=await supabase.auth.getUser();const {error}=await supabase.from('change_proposals').update({status:'rejected',reviewed_by:user?.id||null,reviewed_at:new Date().toISOString()}).eq('id',p.id);if(error)return notify(error.message);notify('Proposta rejeitada.');onRefresh()}
  const pending=proposals.filter((x:any)=>x.status==='pending')
  return <div className="stack"><section className="panel pad"><div className="sectionTitle"><div><h2>Memória do Astra</h2><p>O sistema guarda como cada família de arquivo desse fornecedor foi interpretada.</p></div></div><div className="aiProfiles">{profiles.map((x:any)=><article key={x.id}><div><strong>{DOC_TYPES.find(d=>d[0]===x.document_type)?.[1]||x.document_type}</strong><small>{x.profile_name} · versão {x.version}</small></div><div><span>Confiança</span><b>{pct(x.confidence)}</b></div><div><span>Aprovações</span><b>{x.successful_runs}</b></div><div><span>Mapeamentos</span><b>{Object.keys(x.learned_mapping||{}).length}</b></div></article>)}{!profiles.length&&<Empty text="A memória começa a se formar na primeira importação."/>}</div></section>
    <section className="panel"><div className="panelHead"><div><h2>Propostas para aprovação</h2><p>Nada altera o cadastro oficial sem sua decisão.</p></div></div><div className="proposalList">{pending.map((p:any)=><article className="proposal" key={p.id}><div className="proposalMain"><div><Badge tone={p.action==='create'?'blue':'amber'}>{p.action==='create'?'CRIAR':'ATUALIZAR'}</Badge><h3>{p.proposed_data?.name||'Produto'}</h3><p>{p.proposed_data?.code?`Código ${p.proposed_data.code} · `:''}{p.proposed_data?.dimensions?.length||0} medidas · {p.proposed_data?.groups?.length||0} grupos · {p.proposed_data?.prices?.length||0} preços</p></div><strong className="confidence">{pct(p.confidence)}</strong></div><div className="proposalActions"><button disabled={busy===p.id} onClick={()=>reject(p)}>Rejeitar</button><button disabled={busy===p.id} className="primary" onClick={()=>approve(p)}>{busy===p.id?'Aplicando…':'Aprovar e aplicar'}</button></div></article>)}{!pending.length&&<Empty text="Nenhuma proposta pendente para este fornecedor."/>}</div></section></div>
}

async function applyProposal({supabase,proposal,brand,documents}:any){
  if(proposal.status!=='pending')return
  const data=proposal.proposed_data||{}
  const {data:{user}}=await supabase.auth.getUser()
  let productId=proposal.target_id
  if(!productId&&data.code){
    const code=await supabase.from('product_brand_codes').select('product_id').eq('brand_id',brand.id).eq('product_code',data.code).maybeSingle()
    productId=code.data?.product_id
  }
  if(!productId){
    const existing=await supabase.from('products').select('id').eq('brand_id',brand.id).ilike('name',data.name).limit(1).maybeSingle()
    productId=existing.data?.id
  }
  if(!productId){
    const created=await supabase.from('products').insert({name:data.name,slug:`${slugify(data.name)}-${Date.now().toString().slice(-6)}`,brand_id:brand.id,manufacturer_code:data.code||null,status:'in_review',created_by:user?.id||null,updated_by:user?.id||null}).select().single()
    if(created.error)throw created.error;productId=created.data.id
  }else{
    const up=await supabase.from('products').update({manufacturer_code:data.code||undefined,updated_by:user?.id||null}).eq('id',productId);if(up.error)throw up.error
  }
  if(data.code){const codeUp=await supabase.from('product_brand_codes').upsert({product_id:productId,brand_id:brand.id,product_code:data.code,is_primary:true,metadata:{source_document_id:proposal.source_document_id}},{onConflict:'brand_id,product_code'});if(codeUp.error)throw codeUp.error}
  const existingDims=await supabase.from('product_dimensions').select('label').eq('product_id',productId)
  const dimSet=new Set((existingDims.data||[]).map((x:any)=>norm(x.label)))
  const newDims=(data.dimensions||[]).filter((d:any)=>d.label&&!dimSet.has(norm(d.label))).map((d:any,i:number)=>({product_id:productId,label:d.label,width_mm:d.width_mm||null,depth_mm:d.depth_mm||null,height_mm:d.height_mm||null,sort_order:i,metadata:{source_document_id:proposal.source_document_id}}))
  if(newDims.length){const dres=await supabase.from('product_dimensions').insert(newDims);if(dres.error)throw dres.error}
  if((data.groups||[]).length){
    const code=`${slugify(brand.name)}-grupo-preco`
    let og=await supabase.from('option_groups').select('*').eq('code',code).maybeSingle()
    if(!og.data){og=await supabase.from('option_groups').insert({code,name:`Grupo de preço · ${brand.name}`,kind:'textile',selection_mode:'single'}).select().single()}
    if(og.data){
      const link=await supabase.from('product_option_groups').upsert({product_id:productId,option_group_id:og.data.id,is_required:false,min_select:0,max_select:1,sort_order:0},{onConflict:'product_id,option_group_id'});if(link.error)throw link.error
      for(const [i,g] of (data.groups||[]).entries()){
        const vc=`${code}-${slugify(g)}`;let ov=await supabase.from('option_values').select('*').eq('option_group_id',og.data.id).eq('code',vc).maybeSingle()
        if(!ov.data)ov=await supabase.from('option_values').insert({option_group_id:og.data.id,code:vc,name:g,normalized_name:norm(g),sort_order:i,metadata:{brand_id:brand.id}}).select().single()
        if(ov.data){const vl=await supabase.from('product_option_values').upsert({product_id:productId,option_value_id:ov.data.id,is_active:true,metadata:{source_document_id:proposal.source_document_id}},{onConflict:'product_id,option_value_id'});if(vl.error)throw vl.error}
      }
    }
  }
  const doc=documents.find((d:any)=>d.id===proposal.source_document_id)|| (await supabase.from('source_documents').select('*').eq('id',proposal.source_document_id).single()).data
  let pt=await supabase.from('price_tables').select('*').eq('source_document_id',proposal.source_document_id).maybeSingle()
  if(!pt.data){
    pt=await supabase.from('price_tables').insert({brand_id:brand.id,source_document_id:proposal.source_document_id,name:doc?.filename||`Tabela ${brand.name}`,currency:'BRL',valid_from:doc?.valid_from||null,valid_until:doc?.valid_until||null,status:'active',created_by:user?.id||null,price_basis:doc?.price_basis||'cost',ipi_mode:doc?.ipi_mode||'unknown',ipi_rate:doc?.ipi_rate||null,freight_mode:doc?.freight_mode||'unknown',freight_value:doc?.freight_value||null,metadata:{approved_from_proposal:true}}).select().single()
    if(pt.error)throw pt.error
  }
  const entries=(data.prices||[]).map((r:any)=>({price_table_id:pt.data.id,product_id:productId,supplier_product_code:data.code||null,dimension_signature:{label:r.dimension_label,width_mm:r.width_mm,depth_mm:r.depth_mm,height_mm:r.height_mm},pricing_group:r.pricing_group||null,configuration:{},cost_price:(doc?.price_basis||r.price_basis)==='cost'?r.price_value:null,suggested_retail:(doc?.price_basis||r.price_basis)==='sale'?r.price_value:null,currency:r.currency||'BRL',source_locator:r.source_locator||{},price_basis:doc?.price_basis||r.price_basis||'cost',source_price:r.price_value,ipi_rate:doc?.ipi_rate||null,freight_value:doc?.freight_value||null,price_value:r.price_value}))
  if(entries.length){for(let i=0;i<entries.length;i+=250){const res=await supabase.from('price_entries').insert(entries.slice(i,i+250));if(res.error)throw res.error}}
  const upd=await supabase.from('change_proposals').update({status:'applied',reviewed_by:user?.id||null,reviewed_at:new Date().toISOString(),applied_at:new Date().toISOString(),target_id:productId}).eq('id',proposal.id);if(upd.error)throw upd.error
  const profile=await supabase.from('supplier_ai_profiles').select('*').eq('brand_id',brand.id).eq('document_type',doc?.document_type||'price_table').eq('is_active',true).order('version',{ascending:false}).limit(1).maybeSingle()
  if(profile.data){const examples=[...(profile.data.approved_examples||[]),{name:data.name,code:data.code,dimensions:data.dimensions,groups:data.groups,approved_at:new Date().toISOString()}].slice(-25);await supabase.from('supplier_ai_profiles').update({approved_examples:examples,successful_runs:Number(profile.data.successful_runs||0)+1,confidence:Math.min(.99,Number(profile.data.confidence||.5)+.02),last_used_at:new Date().toISOString()}).eq('id',profile.data.id)}
  const rem=await supabase.from('change_proposals').select('id',{count:'exact',head:true}).eq('source_document_id',proposal.source_document_id).eq('status','pending')
  if((rem.count||0)<=0)await supabase.from('source_documents').update({status:'approved',approval_status:'approved'}).eq('id',proposal.source_document_id)
}

function ReviewCenter({supabase,proposals,documents,brands,onRefresh,notify}:any){
  const pending=proposals.filter((p:any)=>p.status==='pending'),[busy,setBusy]=useState('')
  async function approve(p:any){setBusy(p.id);try{const brand=brands.find((b:any)=>b.id===p.brand_id);await applyProposal({supabase,proposal:p,brand,documents});notify('Proposta aplicada.');onRefresh()}catch(e:any){notify(e.message||String(e))}finally{setBusy('')}}
  async function reject(p:any){const {data:{user}}=await supabase.auth.getUser();const {error}=await supabase.from('change_proposals').update({status:'rejected',reviewed_by:user?.id,reviewed_at:new Date().toISOString()}).eq('id',p.id);if(error)return notify(error.message);notify('Proposta rejeitada.');onRefresh()}
  return <><PageHeader eyebrow="GOVERNANÇA" title="Revisões" desc="Fila única das mudanças sugeridas pelo Astra antes de virar dado oficial."/><section className="panel"><div className="reviewRows">{pending.map((p:any)=><article className="reviewRow" key={p.id}><div><div className="chips"><Badge tone={p.action==='create'?'blue':'amber'}>{p.action==='create'?'CRIAR':'ATUALIZAR'}</Badge><Badge>{brands.find((b:any)=>b.id===p.brand_id)?.name||'Fornecedor'}</Badge></div><h3>{p.proposed_data?.name||p.entity_type}</h3><p>{p.proposed_data?.code?`Cód. ${p.proposed_data.code} · `:''}{p.proposed_data?.dimensions?.length||0} medidas · {p.proposed_data?.groups?.length||0} grupos · {p.proposed_data?.prices?.length||0} preços</p></div><div className="reviewScore"><span>confiança</span><b>{pct(p.confidence)}</b></div><div className="proposalActions"><button onClick={()=>reject(p)}>Rejeitar</button><button disabled={busy===p.id} className="primary" onClick={()=>approve(p)}>{busy===p.id?'Aplicando…':'Aprovar'}</button></div></article>)}{!pending.length&&<Empty text="Fila zerada. Nenhuma mudança aguardando aprovação."/>}</div></section></>
}

function Modal({title,onClose,children,wide}:any){return <div className="modalBg" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><div className={cls('modal',wide&&'wide')}><div className="modalHead"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div>}
function Field({label,children,wide}:any){return <label className={cls('field',wide&&'wide')}><span>{label}</span>{children}</label>}
