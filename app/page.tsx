'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import SupplierView from '@/components/SupplierView'
import Modal from '@/components/Modal'
import ProductDetail from '@/components/ProductDetail'
import { applyProductProposal } from '@/lib/applyProposal'
import { parseSupplierWorkbook } from '@/lib/astra'
import { queryAll } from '@/lib/queryAll'
import { syncSalesOptionsForBrand } from '@/lib/salesOptions'
import { numberValue, slug, STATUS_LABELS, type AnyRow } from '@/lib/utils'

type Brand = AnyRow & {id:string;name:string}
type Product = AnyRow & {id:string;name:string;brand_id?:string|null}
type MainTab = 'catalogo'|'fornecedores'|'inteligencia'
type SupplierTab = 'overview'|'products'|'files'|'terms'|'promos'|'reps'|'intelligence'

export default function Home(){
  const supabase=useMemo(()=>{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    return url&&key?createClient(url,key):null
  },[])
  const [session,setSession]=useState<any>(null),[profile,setProfile]=useState<any>(null)
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState('')
  const [brands,setBrands]=useState<Brand[]>([]),[products,setProducts]=useState<Product[]>([]),[allProposals,setAllProposals]=useState<AnyRow[]>([])
  const [active,setActive]=useState<MainTab>('catalogo'),[selectedBrand,setSelectedBrand]=useState<Brand|null>(null),[supplierTab,setSupplierTab]=useState<SupplierTab>('overview')
  const [selectedProduct,setSelectedProduct]=useState<Product|null>(null)
  const [docs,setDocs]=useState<AnyRow[]>([]),[terms,setTerms]=useState<AnyRow[]>([]),[promos,setPromos]=useState<AnyRow[]>([]),[reps,setReps]=useState<AnyRow[]>([]),[proposals,setProposals]=useState<AnyRow[]>([]),[profiles,setProfiles]=useState<AnyRow[]>([])
  const operation=useRef(false),supplierRequest=useRef(0)
  const [jobs,setJobs]=useState<AnyRow[]>([])
  const [notice,setNotice]=useState(''),[loadError,setLoadError]=useState('')
  const [search,setSearch]=useState(''),[busy,setBusy]=useState(''),[modal,setModal]=useState<string|null>(null),[form,setForm]=useState<AnyRow>({})

  useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data})=>setSession(data.session));const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe()},[supabase])
  useEffect(()=>{if(session&&supabase)loadBase()},[session,supabase])
  useEffect(()=>{if(selectedBrand&&supabase)loadSupplier(selectedBrand.id)},[selectedBrand?.id])

  async function loadBase(){
    if(!supabase||!session)return
    const [b,p,pr,cp]=await Promise.all([
      supabase.from('brands').select('*').order('name'),
      queryAll((from,to)=>supabase.from('products').select('*').order('name').order('id').range(from,to)).then(data=>({data,error:null})).catch(error=>({data:null,error})),
      supabase.from('profiles').select('*').eq('user_id',session.user.id).maybeSingle(),
      supabase.from('change_proposals').select('*').eq('status','pending').order('created_at',{ascending:false}).limit(1000)
    ])
    const error=[b,p,pr,cp].find(r=>r.error)?.error
    if(error){setLoadError(`Não foi possível carregar a base: ${error.message}. Tente novamente.`);return}
    setLoadError('')
    setBrands((b.data||[]) as Brand[]);setProducts((p.data||[]) as Product[]);setProfile(pr.data);setAllProposals(cp.data||[])
  }
  async function loadSupplier(id:string){
    if(!supabase)return
    const request=++supplierRequest.current
    const [d,t,pm,r,cp,ai]=await Promise.all([
      supabase.from('source_documents').select('*').eq('brand_id',id).order('created_at',{ascending:false}),
      supabase.from('supplier_commercial_terms').select('*').eq('brand_id',id).order('created_at',{ascending:false}),
      supabase.from('supplier_promotions').select('*').eq('brand_id',id).order('created_at',{ascending:false}),
      supabase.from('brand_representatives').select('*').eq('brand_id',id).order('is_primary',{ascending:false}),
      supabase.from('change_proposals').select('*').eq('brand_id',id).order('created_at',{ascending:false}).limit(1000),
      supabase.from('supplier_ai_profiles').select('*').eq('brand_id',id).order('updated_at',{ascending:false})
    ])
    if(request!==supplierRequest.current)return
    const error=[d,t,pm,r,cp,ai].find(r=>r.error)?.error
    if(error){setLoadError(`Não foi possível carregar o fornecedor: ${error.message}`);return}
    let recentJobs:AnyRow[]=[]
    if(d.data?.length){const result=await supabase.from('ingestion_jobs').select('*').in('source_document_id',d.data.map(x=>x.id)).order('created_at',{ascending:false});if(result.error){setLoadError(result.error.message);return}recentJobs=result.data||[]}
    if(request!==supplierRequest.current)return
    setJobs(recentJobs);setLoadError('')
    setDocs(d.data||[]);setTerms(t.data||[]);setPromos(pm.data||[]);setReps(r.data||[]);setProposals(cp.data||[]);setProfiles(ai.data||[])
  }
  async function login(e:React.FormEvent){e.preventDefault();setMessage('Entrando...');if(!supabase)return setMessage('Supabase não configurado.');const {error}=await supabase.auth.signInWithPassword({email,password});setMessage(error?error.message:'')}
  function openModal(kind:string,initial:AnyRow={}){setForm(initial);setModal(kind)}
  function openSupplier(b:Brand){setDocs([]);setProposals([]);setJobs([]);setTerms([]);setPromos([]);setReps([]);setProfiles([]);setSelectedBrand(b);setSupplierTab('overview');setActive('fornecedores')}

  async function saveBrand(){
    if(!supabase)return
    setBusy('Salvando fornecedor')
    const payload={name:form.name,slug:slug(form.name),legal_name:form.legal_name||null,tax_id:form.tax_id||null,website_url:form.website_url||null,email:form.email||null,phone:form.phone||null,city:form.city||null,state:form.state||null,country:form.country||'Brasil',internal_code:form.internal_code||null,notes:form.notes||null,is_active:true}
    const q=form.id?supabase.from('brands').update(payload).eq('id',form.id):supabase.from('brands').insert(payload)
    const {error}=await q
    if(error)alert(error.message);else{setModal(null);await loadBase();if(form.id&&selectedBrand?.id===form.id){const {data}=await supabase.from('brands').select('*').eq('id',form.id).single();setSelectedBrand(data as Brand)}}
    setBusy('')
  }
  async function saveTerms(){
    if(!supabase||!selectedBrand)return
    setBusy('Atualizando política comercial')
    const {error}=await supabase.from('supplier_commercial_terms').insert({brand_id:selectedBrand.id,valid_from:form.valid_from||null,valid_until:form.valid_until||null,target_markup:numberValue(form.target_markup),minimum_markup:numberValue(form.minimum_markup),payment_terms:form.payment_terms||null,lead_time_min_days:numberValue(form.lead_time_min_days),lead_time_max_days:numberValue(form.lead_time_max_days),ipi_mode:form.ipi_mode||'unknown',ipi_rate:numberValue(form.ipi_rate),freight_mode:form.freight_mode||'unknown',freight_value:numberValue(form.freight_value),notes:form.notes||null,status:'approved',created_by:session.user.id,approved_by:session.user.id,approved_at:new Date().toISOString()})
    if(error)alert(error.message);else{
      try{await syncSalesOptionsForBrand(supabase,selectedBrand.id)}catch(e:any){console.error(e)}
      setModal(null);await loadSupplier(selectedBrand.id)
    }
    setBusy('')
  }
  async function savePromo(){
    if(!supabase||!selectedBrand)return
    const {error}=await supabase.from('supplier_promotions').insert({brand_id:selectedBrand.id,name:form.name,description:form.description||null,valid_from:form.valid_from||null,valid_until:form.valid_until||null,rules:{discount_percent:numberValue(form.discount_percent),scope:'all',notes:form.rules_notes||''},status:'approved',created_by:session.user.id,approved_by:session.user.id,approved_at:new Date().toISOString()})
    if(error)alert(error.message);else{setModal(null);await loadSupplier(selectedBrand.id)}
  }
  async function saveRep(){
    if(!supabase||!selectedBrand)return
    const {error}=await supabase.from('brand_representatives').insert({brand_id:selectedBrand.id,company_name:form.company_name||null,contact_name:form.contact_name,email:form.email||null,phone:form.phone||null,whatsapp:form.whatsapp||null,region:form.region||null,is_primary:!!form.is_primary,is_active:true,notes:form.notes||null})
    if(error)alert(error.message);else{setModal(null);await loadSupplier(selectedBrand.id)}
  }

  async function uploadDocument(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!selectedBrand||operation.current)return
    const input=e.currentTarget.elements.namedItem('file') as HTMLInputElement,file=input.files?.[0];if(!file)return
    const ext=(file.name.split('.').pop()||'').toLowerCase()
    if(!['xlsx','xls','csv','pdf'].includes(ext))return setNotice('Escolha um arquivo Excel, CSV ou PDF.')
    if(!file.size||file.size>20*1024*1024)return setNotice('Selecione um arquivo com conteúdo, de até 20 MB.')
    const automatic=['xlsx','xls','csv'].includes(ext)&&(form.document_type||'price_table')==='price_table'
    if(automatic&&!['cost','sale'].includes(form.price_basis))return setNotice('Informe se os preços são de custo ou venda.')
    const referenceMarkup=numberValue(form.reference_markup)
    if(form.reference_markup&&(referenceMarkup==null||referenceMarkup<=0))return setNotice('O markup deve ser maior que zero.')
    if(form.valid_from&&form.valid_until&&form.valid_from>form.valid_until)return setNotice('A data final deve ser igual ou posterior à inicial.')
    operation.current=true;setNotice('');setBusy('1/3 · Enviando arquivo')
    let documentId:string|undefined,jobId:string|undefined
    try{
      const path=`${selectedBrand.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`
      const up=await supabase.storage.from('supplier-tables').upload(path,file,{upsert:false});if(up.error)throw up.error
      const payload={brand_id:selectedBrand.id,document_type:form.document_type||'price_table',filename:file.name,storage_bucket:'supplier-tables',storage_path:path,mime_type:file.type||null,file_size:file.size,status:'uploaded',price_basis:form.price_basis==='na'?null:form.price_basis||null,reference_markup:referenceMarkup,ipi_mode:form.ipi_mode||'unknown',ipi_rate:numberValue(form.ipi_rate),freight_mode:form.freight_mode||'unknown',freight_value:numberValue(form.freight_value),valid_from:form.valid_from||null,valid_until:form.valid_until||null,processing_instructions:form.processing_instructions||null,approval_status:'pending',commercial_context:{original_extension:ext,reference_markup:referenceMarkup},uploaded_by:session.user.id}
      const di=await supabase.from('source_documents').insert(payload).select().single();if(di.error)throw di.error
      documentId=di.data.id
      if(automatic){
        setBusy('2/3 · Lendo tabela e identificando preços')
        const ji=await supabase.from('ingestion_jobs').insert({source_document_id:di.data.id,status:'queued',parser_type:'astra_pending_v5',created_by:session.user.id,metadata:{filename:file.name}}).select().single();if(ji.error)throw ji.error
        jobId=ji.data.id
        const result=await parseSupplierWorkbook(file,{supabase,brand:selectedBrand,document:di.data,jobId:ji.data.id,products})
        setNotice(`${result.summary.products_detected||0} produtos e ${result.summary.prices_detected||0} preços aguardam revisão. ${(result.summary.warnings||[]).join(' ')}`)
      }else setNotice('Arquivo armazenado para consulta. A leitura automática está disponível para tabelas de preços em Excel e CSV.')
      setBusy('3/3 · Atualizando revisão');setModal(null);await loadSupplier(selectedBrand.id);await loadBase();setSupplierTab(automatic?'intelligence':'files')
    }catch(err:any){
      setNotice(`${err.message||String(err)}${documentId?' O original está na aba Arquivos; consulte o resultado antes de reprocessar.':''}`)
      if(documentId&&!jobId)await supabase.from('source_documents').update({status:'error'}).eq('id',documentId)
      if(documentId){setModal(null);await loadSupplier(selectedBrand.id);setSupplierTab('files')}
    }finally{operation.current=false;setBusy('')}
  }

  async function approve(p:AnyRow){
    if(!supabase||!selectedBrand||operation.current)return
    operation.current=true;setBusy('Aplicando proposta')
    try{await applyProductProposal({supabase,proposal:p,brand:selectedBrand,userId:session.user.id});await loadBase();await loadSupplier(selectedBrand.id)}catch(e:any){setNotice(e.message||String(e));throw e}finally{operation.current=false;setBusy('')}
  }
  async function reject(p:AnyRow){
    if(!supabase||operation.current)return
    operation.current=true;setBusy('Rejeitando proposta')
    try{const result=await supabase.from('change_proposals').update({status:'rejected',reviewed_by:session.user.id,reviewed_at:new Date().toISOString()}).eq('id',p.id).eq('status','pending').select('id').single();if(result.error)throw result.error;if(selectedBrand)await loadSupplier(selectedBrand.id);await loadBase()}
    catch(e:any){setNotice(e.message||String(e))}finally{operation.current=false;setBusy('')}
  }
  async function openOriginal(d:AnyRow){if(!supabase)return;const {data,error}=await supabase.storage.from(d.storage_bucket||'supplier-tables').createSignedUrl(d.storage_path,300);if(error)alert(error.message);else window.open(data.signedUrl,'_blank')}

  if(!session)return <main className="login"><div className="loginCard"><div className="logo">SB</div><p className="eyebrow">GRUPO SB</p><h1>Product Brain</h1><p className="muted">Produtos, fornecedores, tabelas e inteligência em uma única base.</p><form onSubmit={login}><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button>Entrar</button></form>{message&&<p className="message">{message}</p>}</div></main>

  const visibleProducts=products.filter(p=>(p.name+' '+(p.public_id||'')+' '+(p.manufacturer_code||'')).toLowerCase().includes(search.toLowerCase()))
  return <div className="shell"><aside><div className="sideBrand"><div className="logo small">SB</div><div><b>Product Brain</b><small>Grupo SB · {profile?.role||'usuário'}</small></div></div><nav><button className={active==='catalogo'?'on':''} onClick={()=>{setActive('catalogo');setSelectedBrand(null)}}>Catálogo</button><button className={active==='fornecedores'?'on':''} onClick={()=>{setActive('fornecedores');setSelectedBrand(null)}}>Fornecedores / Marcas</button><button className={active==='inteligencia'?'on':''} onClick={()=>{setActive('inteligencia');setSelectedBrand(null)}}>Inteligência / Revisões</button></nav><div className="sideBottom"><small>{session.user.email}</small><button onClick={()=>supabase?.auth.signOut()}>Sair</button></div></aside><main className="content">{busy&&<div className="busy" role="status">{busy}…</div>}{loadError&&<div className="notice error" role="alert">{loadError} <button onClick={()=>{loadBase();if(selectedBrand)loadSupplier(selectedBrand.id)}}>Tentar novamente</button></div>}{notice&&<div className="notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Fechar aviso">×</button></div>}

    {active==='catalogo'&&!selectedBrand&&<><Header eyebrow="PRODUCT BRAIN" title="Catálogo" subtitle="Base central de produtos do Grupo SB." action="+ Novo produto" onAction={()=>openModal('product')}/><div className="stats"><Kpi label="Produtos" value={products.length}/><Kpi label="Fornecedores" value={brands.length}/><Kpi label="Em revisão" value={products.filter(p=>p.status==='in_review').length}/><Kpi label="Ativos" value={products.filter(p=>p.status==='active').length}/></div><section className="panel"><div className="panelHead"><h2>Produtos</h2><input className="search" placeholder="Buscar produto, código…" value={search} onChange={e=>setSearch(e.target.value)}/></div>{visibleProducts.map(p=><button className="productRow productButton" key={p.id} onClick={()=>setSelectedProduct(p)}><div><b>{p.name}</b><small>{p.public_id||'Sem SB-ID'} · {p.manufacturer_code||'sem código fornecedor'}</small></div><span>{brands.find(b=>b.id===p.brand_id)?.name||'Sem fornecedor'}</span><span className="pill">{STATUS_LABELS[p.status]||p.status}</span></button>)}</section></>}

    {active==='fornecedores'&&!selectedBrand&&<><Header eyebrow="ESTRUTURA" title="Fornecedores / Marcas" subtitle="Cadastro, documentos, produtos e inteligência comercial por fornecedor." action="+ Novo fornecedor" onAction={()=>openModal('brand')}/><div className="brandGrid">{brands.map(b=><article className="brandCard" key={b.id} onClick={()=>openSupplier(b)}><div className="brandInitial">{b.name.slice(0,2).toUpperCase()}</div><div><h2>{b.name}</h2><p>{products.filter(p=>p.brand_id===b.id).length} produtos · {b.city||'local não informado'}</p></div><button>Abrir ficha →</button></article>)}</div></>}

    {selectedBrand&&<SupplierView supabase={supabase} brand={selectedBrand} tab={supplierTab} setTab={setSupplierTab} products={products.filter(p=>p.brand_id===selectedBrand.id)} docs={docs} terms={terms} promos={promos} reps={reps} proposals={proposals} profiles={profiles} jobs={jobs} busy={!!busy} refresh={()=>loadSupplier(selectedBrand.id)} onBack={()=>setSelectedBrand(null)} openModal={openModal} approve={approve} reject={reject} openOriginal={openOriginal}/>}

    {active==='inteligencia'&&!selectedBrand&&<><Header eyebrow="ASTRA" title="Revisões pendentes" subtitle="O que a inteligência encontrou antes de virar dado oficial."/><section className="panel"><div className="panelHead"><h2>Por fornecedor</h2><span>{allProposals.filter(p=>p.status==='pending').length} propostas pendentes</span></div>{brands.map(b=>{const n=allProposals.filter(p=>p.brand_id===b.id&&p.status==='pending').length;return <div className="simpleRow" key={b.id}><b>{b.name}</b><span>{n} pendências</span><button onClick={()=>{openSupplier(b);setSupplierTab('intelligence')}}>Revisar</button></div>})}</section></>}
  </main>{modal&&<Modal busy={!!busy} kind={modal} form={form} setForm={setForm} close={()=>setModal(null)} saveBrand={saveBrand} saveTerms={saveTerms} savePromo={savePromo} saveRep={saveRep} uploadDocument={uploadDocument} brands={brands} supabase={supabase} session={session} reload={loadBase}/>} {selectedProduct&&supabase&&<ProductDetail product={selectedProduct} brand={brands.find(b=>b.id===selectedProduct.brand_id)} supabase={supabase} userRole={profile?.role||'vendedor'} onClose={()=>setSelectedProduct(null)}/>}</div>
}

function Header({eyebrow,title,subtitle,action,onAction}:{eyebrow:string,title:string,subtitle:string,action?:string,onAction?:()=>void}){return <header><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{subtitle}</p></div>{action&&<button className="primary" onClick={onAction}>{action}</button>}</header>}
function Kpi({label,value}:{label:string,value:any}){return <article><span>{label}</span><strong>{value}</strong></article>}
