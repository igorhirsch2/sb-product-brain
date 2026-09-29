'use client'

import { createClient } from '@supabase/supabase-js'
import { dateBR, DOC_LABELS, STATUS_LABELS } from '@/lib/utils'

export default function SupplierView({brand,tab,setTab,products,docs,terms,promos,reps,proposals,profiles,onBack,openModal,approve,reject,openOriginal}:any){
  const pending=proposals.filter((p:any)=>p.status==='pending')
  async function reprocess(d:any){
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if(!url||!key)return alert('Supabase não configurado.')
    const supabase=createClient(url,key)
    const {data:{session}}=await supabase.auth.getSession()
    if(!session)return alert('Sua sessão expirou. Entre novamente.')
    if(!confirm(`Reprocessar ${d.filename}? O arquivo original já armazenado será usado.`))return
    const ji=await supabase.from('ingestion_jobs').insert({source_document_id:d.id,status:'processing',parser_type:'astra_server_v2_reprocess',started_at:new Date().toISOString(),created_by:session.user.id,metadata:{reprocess:true,filename:d.filename,document_type:d.document_type,price_basis:d.price_basis}}).select().single()
    if(ji.error)return alert(ji.error.message)
    await supabase.from('source_documents').update({status:'processing',approval_status:'pending'}).eq('id',d.id)
    const response=await fetch('/api/process-document',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({documentId:d.id,jobId:ji.data.id})})
    const body=await response.json().catch(()=>({}))
    if(!response.ok)return alert(body.error||'Falha no reprocessamento.')
    alert(`Concluído: ${body.summary?.products_detected||0} produtos detectados e ${body.summary?.prices_detected||0} preços para revisão.`)
    window.location.reload()
  }
  return <>
    <button className="back" onClick={onBack}>← Fornecedores</button>
    <header><div><p className="eyebrow">FORNECEDOR / MARCA</p><h1>{brand.name}</h1><p className="muted">{[brand.legal_name,brand.city,brand.state].filter(Boolean).join(' · ')||'Ficha central do fornecedor'}</p></div><button className="primary" onClick={()=>openModal('brand',brand)}>Editar cadastro</button></header>
    <div className="supplierTabs">{[['overview','Visão Geral'],['products','Produtos'],['files','Arquivos'],['terms','Condições Comerciais'],['promos','Promoções'],['reps','Representantes'],['intelligence',`Inteligência${pending.length?` (${pending.length})`:''}`]].map(([k,l])=><button key={k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}</button>)}</div>

    {tab==='overview'&&<div className="twoCols">
      <section className="panel pad"><h2>Cadastro</h2><Info label="Razão social" value={brand.legal_name}/><Info label="CNPJ" value={brand.tax_id}/><Info label="Site" value={brand.website_url}/><Info label="E-mail" value={brand.email}/><Info label="Telefone" value={brand.phone}/><Info label="Local" value={[brand.city,brand.state,brand.country].filter(Boolean).join(' / ')}/><Info label="Observações" value={brand.notes}/></section>
      <section className="panel pad"><h2>Resumo operacional</h2><div className="miniStats"><Kpi label="Produtos" value={products.length}/><Kpi label="Arquivos" value={docs.length}/><Kpi label="Pendências IA" value={pending.length}/><Kpi label="Promoções" value={promos.filter((x:any)=>x.status==='approved').length}/></div>{terms[0]&&<><h3>Condição vigente</h3><Info label="Markup alvo / mínimo" value={`${terms[0].target_markup||'—'} / ${terms[0].minimum_markup||'—'}`}/><Info label="Prazo" value={`${terms[0].lead_time_min_days||'—'}–${terms[0].lead_time_max_days||'—'} dias`}/><Info label="Pagamento" value={terms[0].payment_terms}/></>}</section>
    </div>}

    {tab==='products'&&<section className="panel"><div className="panelHead"><h2>Produtos do fornecedor</h2><span>{products.length}</span></div>{products.map((p:any)=><div className="productRow" key={p.id}><div><b>{p.name}</b><small>{p.public_id||'Sem SB-ID'} · {p.manufacturer_code||'sem código'}</small></div><span className="pill">{STATUS_LABELS[p.status]||p.status}</span></div>)}</section>}

    {tab==='files'&&<><SectionTitle title="Central de arquivos" text="Tabelas, catálogos, acabamentos, promoções e condições comerciais." action="+ Importar arquivo" onAction={()=>openModal('upload',{document_type:'price_table',price_basis:'cost',ipi_mode:'unknown',freight_mode:'unknown'})}/><div className="docGrid">{docs.map((d:any)=><article className="docCard" key={d.id}><div className="docIcon">{d.document_type==='price_table'?'$':'⌁'}</div><div><b>{d.filename}</b><p>{DOC_LABELS[d.document_type]||d.document_type} · {d.price_basis==='cost'?'Custo':d.price_basis==='sale'?'Venda':'—'}</p><div className="tags"><span className={`pill ${d.status==='error'?'danger':''}`}>{STATUS_LABELS[d.status]||d.status}</span>{d.valid_from&&<span className="pill">desde {dateBR(d.valid_from)}</span>}</div></div><div className="docActions"><button onClick={()=>openOriginal(d)}>Original</button>{/\.(xlsx|xls|csv)$/i.test(d.filename)&&<button onClick={()=>reprocess(d)}>Reprocessar</button>}</div></article>)}</div></>}

    {tab==='terms'&&<><SectionTitle title="Condições comerciais" text="Histórico versionado para preservar o contexto de cada venda." action="+ Nova condição" onAction={()=>openModal('terms',{ipi_mode:'unknown',freight_mode:'unknown'})}/><section className="panel">{terms.map((t:any)=><div className="termRow" key={t.id}><div><b>{dateBR(t.valid_from)} → {dateBR(t.valid_until)}</b><small>{t.payment_terms||'Pagamento não informado'}</small></div><span>Markup {t.target_markup||'—'} / mín. {t.minimum_markup||'—'}</span><span>{t.lead_time_min_days||'—'}–{t.lead_time_max_days||'—'} dias</span><span>IPI {t.ipi_rate??'—'}% · Frete {t.freight_value??'—'}</span></div>)}</section></>}

    {tab==='promos'&&<><SectionTitle title="Promoções" text="Camada comercial temporária; não sobrescreve a tabela-base." action="+ Nova promoção" onAction={()=>openModal('promo')}/><div className="brandGrid">{promos.map((p:any)=><article className="brandCard" key={p.id}><div><h2>{p.name}</h2><p>{p.description}</p><p><b>{p.rules?.discount_percent||'—'}%</b> · {dateBR(p.valid_from)} a {dateBR(p.valid_until)}</p></div></article>)}</div></>}

    {tab==='reps'&&<><SectionTitle title="Representantes" text="Contatos comerciais vinculados ao fornecedor." action="+ Representante" onAction={()=>openModal('rep')}/><div className="brandGrid">{reps.map((r:any)=><article className="brandCard" key={r.id}><div><h2>{r.contact_name}{r.is_primary?' ★':''}</h2><p>{r.company_name||brand.name}</p><p>{r.whatsapp||r.phone||'sem telefone'} · {r.region||'região não informada'}</p></div></article>)}</div></>}

    {tab==='intelligence'&&<><SectionTitle title="Astra · Interpretação e aprovação" text="O sistema aprende os padrões do fornecedor; só propostas aprovadas entram no catálogo."/><div className="aiStats">{profiles.map((p:any)=><article className="panel pad" key={p.id}><span className="eyebrow">PERFIL DE LEITURA</span><h3>{p.profile_name}</h3><p>Versão {p.version} · {p.successful_runs} leituras · confiança {Math.round(Number(p.confidence||0)*100)}%</p><small>{(p.learned_mapping?.price_headers||[]).slice(0,8).join(' · ')||'Ainda aprendendo cabeçalhos'}</small></article>)}</div><section className="panel"><div className="panelHead"><h2>Propostas para aprovação</h2><span>{pending.length} pendentes</span></div>{pending.length===0?<div className="empty">Nenhuma proposta pendente.</div>:pending.map((p:any)=><div className="proposal" key={p.id}><div><span className="eyebrow">{p.action==='create'?'NOVO PRODUTO':'ATUALIZAÇÃO'}</span><h3>{p.proposed_data?.name}</h3><p>{p.proposed_data?.supplier_codes?.length||1} códigos · {p.proposed_data?.variant_labels?.length||0} variações · {p.proposed_data?.dimensions?.length||0} medidas · {p.proposed_data?.pricing_groups?.length||0} grupos · {p.proposed_data?.price_count||0} preços</p><small>Confiança: {Math.round(Number(p.confidence||0)*100)}%</small></div><div className="proposalActions"><button onClick={()=>reject(p)}>Rejeitar</button><button className="primary" onClick={()=>approve(p)}>Aprovar e aplicar</button></div></div>)}</section></>}
  </>
}

function Info({label,value}:{label:string,value:any}){return <div className="info"><span>{label}</span><b>{value||'—'}</b></div>}
function Kpi({label,value}:{label:string,value:any}){return <article><span>{label}</span><strong>{value}</strong></article>}
function SectionTitle({title,text,action,onAction}:{title:string,text:string,action?:string,onAction?:()=>void}){return <div className="sectionAction"><div><h2>{title}</h2><p className="muted">{text}</p></div>{action&&<button className="primary" onClick={onAction}>{action}</button>}</div>}
