'use client'

import { useEffect, useRef, useState } from 'react'
import { queryAll } from '@/lib/queryAll'
import { priceOverrides } from '@/lib/proposalReview'
import { dateBR, DOC_LABELS, STATUS_LABELS } from '@/lib/utils'

const cleanLines=(value:string)=>Array.from(new Set(value.split(/\n|,/).map(x=>x.trim()).filter(Boolean)))
const asLines=(value:any)=>Array.isArray(value)?value.filter(Boolean).join('\n'):''
const inferredType=(name:string)=>{
  const n=String(name||'').trim().split(/\s+/)[0]||''
  return /^(sofá|sofa|poltrona|pufe|puff|mesa|cadeira|chaise|banqueta|banco|recamiê|recamier|almofada)$/i.test(n)?n:''
}
const withoutReview=(data:any)=>{const copy={...(data||{})};delete copy._human_review;return copy}

export default function SupplierView({supabase,jobs=[],busy=false,refresh,brand,tab,setTab,products,docs,terms,promos,reps,proposals,profiles,onBack,openModal,approve,reject,openOriginal}:any){
  const [localProposals,setLocalProposals]=useState<any[]>(proposals||[])
  const [editor,setEditor]=useState<any|null>(null)
  const [editorMode,setEditorMode]=useState<'edit'|'source'>('edit')
  const [draft,setDraft]=useState<any>({})
  const [sourceRows,setSourceRows]=useState<any[]>([])
  const [loadingSource,setLoadingSource]=useState(false)
  const [saving,setSaving]=useState(false)
  const [selectedIds,setSelectedIds]=useState<Set<string>>(new Set())
  const [bulkType,setBulkType]=useState('')
  const [reviewSearch,setReviewSearch]=useState(''),[documentFilter,setDocumentFilter]=useState('')
  const [feedback,setFeedback]=useState(''),[reprocessing,setReprocessing]=useState<string|null>(null)
  const [sourceLimit,setSourceLimit]=useState(100)
  const sourceRequest=useRef(0),reprocessLock=useRef(false)

  useEffect(()=>setLocalProposals(proposals||[]),[proposals])
  const pending=localProposals.filter((p:any)=>p.status==='pending'&&jobs.find((j:any)=>j.id===p.job_id)?.status==='review')
  const visiblePending=pending.filter((p:any)=>(!documentFilter||p.source_document_id===documentFilter)&&`${p.proposed_data?.name||''} ${(p.proposed_data?.supplier_codes||[]).join(' ')}`.toLocaleLowerCase('pt-BR').includes(reviewSearch.toLocaleLowerCase('pt-BR')))

  function client(){return supabase}

  async function reprocess(d:any){
    if(reprocessLock.current||busy)return
    const supabase=client();if(!supabase)return setFeedback('Supabase não configurado.')
    const latest=jobs.find((j:any)=>j.source_document_id===d.id)
    if(latest?.status==='processing')return setFeedback('Este arquivo está em processamento. Atualize o status antes de tentar novamente.')
    if(pending.some(p=>p.source_document_id===d.id))return setFeedback('Revise ou rejeite as propostas pendentes deste arquivo antes de reprocessar.')
    reprocessLock.current=true;setReprocessing(d.id);setFeedback('Lendo o original armazenado…')
    try{
      const {data:{session}}=await supabase.auth.getSession()
      if(!session)throw new Error('Sua sessão expirou. Entre novamente.')
      const ji=latest?.status==='queued'?{data:latest,error:null}:await supabase.from('ingestion_jobs').insert({source_document_id:d.id,status:'queued',parser_type:'astra_pending_v5',created_by:session.user.id,metadata:{reprocess:true,filename:d.filename}}).select().single()
      if(ji.error)throw ji.error
      const response=await fetch('/api/process-document',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({documentId:d.id,jobId:ji.data.id})})
      const body=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(body.error||'Falha no reprocessamento. Atualize o status para consultar o resultado.')
      setFeedback(`${body.summary?.products_detected||0} produtos e ${body.summary?.prices_detected||0} preços para revisão. ${(body.summary?.warnings||[]).join(' ')}`)
      setTab('intelligence')
    }catch(e:any){setFeedback(e.message||String(e))}
    finally{await refresh?.();reprocessLock.current=false;setReprocessing(null)}
  }

  async function openProposalEditor(p:any,mode:'edit'|'source'='edit'){
    const request=++sourceRequest.current
    setEditor(p);setEditorMode(mode);setSourceRows([]);setSourceLimit(100)
    const pd=p.proposed_data||{}
    const variantLabels=pd.included_variant_labels||pd.variant_labels||[]
    const dimensions=pd.included_dimensions||pd.dimensions||[]
    const pricingGroups=pd.included_pricing_groups||pd.pricing_groups||[]
    setDraft({
      name:pd.name||'',
      product_type:pd.product_type||pd.category||inferredType(pd.name),
      manufacturer_code:pd.manufacturer_code||pd.supplier_codes?.[0]||'',
      supplier_codes:asLines(pd.supplier_codes||[]),
      variant_labels:variantLabels,
      all_variant_labels:pd._human_review?.original?.variant_labels||pd.variant_labels||[],
      dimensions,
      all_dimensions:pd._human_review?.original?.dimensions||pd.dimensions||[],
      pricing_groups:pricingGroups,
      all_pricing_groups:pd._human_review?.original?.pricing_groups||pd.pricing_groups||[],
      modules:asLines(pd.modules||[]),
      review_notes:p.review_notes||'',
      price_overrides:{...(pd.price_overrides||{})}
    })
    setLoadingSource(true)
    try{
      const supabase=client();if(!supabase)return
      const rows=await queryAll<any>((from,to)=>supabase.from('extraction_rows').select('id,row_index,sheet_name,product_name_raw,supplier_product_code,dimension_label,pricing_group,price_value,price_basis,source_locator,raw_payload').eq('job_id',p.job_id).order('id').range(from,to))
      const codes=pd._source_supplier_codes||pd.supplier_codes||[]
      const originalName=pd._human_review?.original?.name||pd.name
      if(request===sourceRequest.current)setSourceRows(rows.filter(r=>codes.length?codes.includes(r.supplier_product_code):r.product_name_raw===originalName))
    }catch(e:any){alert(`Não consegui abrir a origem: ${e.message||e}`)}finally{if(request===sourceRequest.current)setLoadingSource(false)}
  }

  function toggleDraft(field:'variant_labels'|'dimensions'|'pricing_groups',value:string){
    setDraft((d:any)=>{const current=new Set(d[field]||[]);current.has(value)?current.delete(value):current.add(value);return {...d,[field]:Array.from(current)}})
  }

  function changedFields(before:any,after:any){
    return ['name','product_type','manufacturer_code','supplier_codes','variant_labels','dimensions','pricing_groups','price_overrides'].filter(k=>JSON.stringify(before?.[k]??null)!==JSON.stringify(after?.[k]??null))
  }

  async function saveProposalCorrections(applyAfter=false){
    if(!editor)return
    const supabase=client();if(!supabase)return alert('Supabase não configurado.')
    const {data:{session}}=await supabase.auth.getSession();if(!session)return alert('Sua sessão expirou.')
    const before=withoutReview(editor.proposed_data||{})
    const supplierCodes=cleanLines(draft.supplier_codes||'')
    let cleanOverrides:Record<string,number>
    try{cleanOverrides=priceOverrides(draft.price_overrides)}catch(e:any){return alert(e.message)}
    const nextData={
      ...before,
      name:String(draft.name||'').trim(),
      product_type:String(draft.product_type||'').trim()||null,
      category:String(draft.product_type||'').trim()||null,
      manufacturer_code:String(draft.manufacturer_code||supplierCodes[0]||'').trim()||null,
      supplier_codes:supplierCodes,
      _source_supplier_codes:before._source_supplier_codes||before.supplier_codes||[],
      variant_labels:before._human_review?.original?.variant_labels||draft.all_variant_labels||[],
      included_variant_labels:draft.variant_labels||[],
      dimensions:draft.all_dimensions||[],
      included_dimensions:draft.dimensions||[],
      pricing_groups:draft.all_pricing_groups||[],
      included_pricing_groups:draft.pricing_groups||[],
      modules:cleanLines(draft.modules||''),
      price_overrides:cleanOverrides
    }
    const original=editor.proposed_data?._human_review?.original||before
    nextData._human_review={
      original,
      last_edited_at:new Date().toISOString(),
      last_edited_by:session.user.id,
      corrected_fields:changedFields(before,nextData)
    }
    if(!nextData.name)return alert('Informe o nome do produto.')
    if(!nextData.supplier_codes.length)return alert('Mantenha ao menos um código do fornecedor.')
    setSaving(true)
    try{
      const {error}=await supabase.from('change_proposals').update({proposed_data:nextData,review_notes:draft.review_notes||null}).eq('id',editor.id).eq('status','pending').select('id').single()
      if(error)throw error
      const updated={...editor,proposed_data:nextData,review_notes:draft.review_notes||null}
      setLocalProposals(list=>list.map(x=>x.id===editor.id?updated:x))
      if(applyAfter)await approve(updated)
      setEditor(null)
    }catch(e:any){alert(e.message||String(e))}finally{setSaving(false)}
  }

  async function applyBulkType(){
    const type=bulkType.trim();if(!type||!selectedIds.size)return
    const supabase=client();if(!supabase)return
    const {data:{session}}=await supabase.auth.getSession();if(!session)return alert('Sua sessão expirou.')
    setSaving(true)
    try{
      const next=[...localProposals]
      for(const id of selectedIds){
        const index=next.findIndex(p=>p.id===id);if(index<0)continue
        const p=next[index],before=withoutReview(p.proposed_data||{})
        const nextData={...before,product_type:type,category:type,_human_review:{original:p.proposed_data?._human_review?.original||before,last_edited_at:new Date().toISOString(),last_edited_by:session.user.id,corrected_fields:Array.from(new Set([...(p.proposed_data?._human_review?.corrected_fields||[]),'product_type']))}}
        const {error}=await supabase.from('change_proposals').update({proposed_data:nextData}).eq('id',id);if(error)throw error
        next[index]={...p,proposed_data:nextData}
      }
      setLocalProposals(next);setSelectedIds(new Set());setBulkType('')
    }catch(e:any){alert(e.message||String(e))}finally{setSaving(false)}
  }

  function toggleSelected(id:string){setSelectedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})}
  function selectAll(){setSelectedIds(visiblePending.every(p=>selectedIds.has(p.id))?new Set():new Set(visiblePending.map((p:any)=>p.id)))}

  return <>
    {feedback&&<div className="notice" role="status">{feedback}<button onClick={()=>setFeedback('')} aria-label="Fechar aviso">×</button></div>}
    <button className="back" onClick={onBack}>← Fornecedores</button>
    <header><div><p className="eyebrow">FORNECEDOR / MARCA</p><h1>{brand.name}</h1><p className="muted">{[brand.legal_name,brand.city,brand.state].filter(Boolean).join(' · ')||'Ficha central do fornecedor'}</p></div><button className="primary" onClick={()=>openModal('brand',brand)}>Editar cadastro</button></header>
    <div className="supplierTabs">{[['overview','Visão Geral'],['products','Produtos'],['files','Arquivos'],['terms','Condições Comerciais'],['promos','Promoções'],['reps','Representantes'],['intelligence',`Inteligência${pending.length?` (${pending.length})`:''}`]].map(([k,l])=><button key={k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}</button>)}</div>

    {tab==='overview'&&<div className="twoCols">
      <section className="panel pad"><h2>Cadastro</h2><Info label="Razão social" value={brand.legal_name}/><Info label="CNPJ" value={brand.tax_id}/><Info label="Site" value={brand.website_url}/><Info label="E-mail" value={brand.email}/><Info label="Telefone" value={brand.phone}/><Info label="Local" value={[brand.city,brand.state,brand.country].filter(Boolean).join(' / ')}/><Info label="Observações" value={brand.notes}/></section>
      <section className="panel pad"><h2>Resumo operacional</h2><div className="miniStats"><Kpi label="Produtos" value={products.length}/><Kpi label="Arquivos" value={docs.length}/><Kpi label="Pendências IA" value={pending.length}/><Kpi label="Promoções" value={promos.filter((x:any)=>x.status==='approved').length}/></div>{terms[0]&&<><h3>Condição vigente</h3><Info label="Markup alvo / mínimo" value={`${terms[0].target_markup||'—'} / ${terms[0].minimum_markup||'—'}`}/><Info label="Prazo" value={`${terms[0].lead_time_min_days||'—'}–${terms[0].lead_time_max_days||'—'} dias`}/><Info label="Pagamento" value={terms[0].payment_terms}/></>}</section>
    </div>}

    {tab==='products'&&<section className="panel"><div className="panelHead"><h2>Produtos do fornecedor</h2><span>{products.length}</span></div>{products.map((p:any)=><div className="productRow" key={p.id}><div><b>{p.name}</b><small>{p.public_id||'Sem SB-ID'} · {p.manufacturer_code||'sem código'}</small></div><span className="pill">{STATUS_LABELS[p.status]||p.status}</span></div>)}</section>}

    {tab==='files'&&<><SectionTitle title="Central de arquivos" text="Tabelas, catálogos, acabamentos, promoções e condições comerciais." action="+ Importar arquivo" onAction={()=>openModal('upload',{document_type:'price_table',price_basis:'cost',ipi_mode:'unknown',freight_mode:'unknown'})}/><button onClick={()=>refresh?.()} disabled={!!reprocessing}>Atualizar status</button><div className="docGrid">{docs.map((d:any)=><article className="docCard" key={d.id}><div className="docIcon">{d.document_type==='price_table'?'$':'⌁'}</div><div><b>{d.filename}</b><p>{DOC_LABELS[d.document_type]||d.document_type} · {d.price_basis==='cost'?'Custo':d.price_basis==='sale'?'Venda':'—'}</p><div className="tags"><span className={`pill ${d.status==='error'?'danger':''}`}>{STATUS_LABELS[d.status]||d.status}</span>{d.valid_from&&<span className="pill">desde {dateBR(d.valid_from)}</span>}</div></div>{jobs.find((j:any)=>j.source_document_id===d.id)&&<div className="jobSummary"><p>{jobs.find((j:any)=>j.source_document_id===d.id)?.extraction_summary?.products_detected||0} produtos · {jobs.find((j:any)=>j.source_document_id===d.id)?.total_rows||0} preços</p>{jobs.find((j:any)=>j.source_document_id===d.id)?.error_message&&<p role="alert">{jobs.find((j:any)=>j.source_document_id===d.id)?.error_message}</p>}{(jobs.find((j:any)=>j.source_document_id===d.id)?.extraction_summary?.warnings||[]).map((w:string)=><p key={w}>{w}</p>)}</div>}<div className="docActions"><button onClick={()=>openOriginal(d)}>Original</button>{d.document_type==='price_table'&&/\.(xlsx|xls|csv)$/i.test(d.filename)&&<button disabled={!!reprocessing||busy||jobs.find((j:any)=>j.source_document_id===d.id)?.status==='processing'} onClick={()=>reprocess(d)}>{reprocessing===d.id?'Processando…':'Reprocessar'}</button>}{localProposals.some(p=>p.source_document_id===d.id&&p.status==='pending')&&<button onClick={()=>{setDocumentFilter(d.id);setTab('intelligence')}}>Revisar produtos</button>}</div></article>)}</div></>}

    {tab==='terms'&&<><SectionTitle title="Condições comerciais" text="Histórico versionado para preservar o contexto de cada venda." action="+ Nova condição" onAction={()=>openModal('terms',{ipi_mode:'unknown',freight_mode:'unknown'})}/><section className="panel">{terms.map((t:any)=><div className="termRow" key={t.id}><div><b>{dateBR(t.valid_from)} → {dateBR(t.valid_until)}</b><small>{t.payment_terms||'Pagamento não informado'}</small></div><span>Markup {t.target_markup||'—'} / mín. {t.minimum_markup||'—'}</span><span>{t.lead_time_min_days||'—'}–{t.lead_time_max_days||'—'} dias</span><span>IPI {t.ipi_rate??'—'}% · Frete {t.freight_value??'—'}</span></div>)}</section></>}

    {tab==='promos'&&<><SectionTitle title="Promoções" text="Camada comercial temporária; não sobrescreve a tabela-base." action="+ Nova promoção" onAction={()=>openModal('promo')}/><div className="brandGrid">{promos.map((p:any)=><article className="brandCard" key={p.id}><div><h2>{p.name}</h2><p>{p.description}</p><p><b>{p.rules?.discount_percent||'—'}%</b> · {dateBR(p.valid_from)} a {dateBR(p.valid_until)}</p></div></article>)}</div></>}

    {tab==='reps'&&<><SectionTitle title="Representantes" text="Contatos comerciais vinculados ao fornecedor." action="+ Representante" onAction={()=>openModal('rep')}/><div className="brandGrid">{reps.map((r:any)=><article className="brandCard" key={r.id}><div><h2>{r.contact_name}{r.is_primary?' ★':''}</h2><p>{r.company_name||brand.name}</p><p>{r.whatsapp||r.phone||'sem telefone'} · {r.region||'região não informada'}</p></div></article>)}</div></>}

    {tab==='intelligence'&&<><SectionTitle title="Astra · Interpretação e aprovação" text="Revise, corrija e aprove. A extração original fica preservada para auditoria e aprendizado do fornecedor."/><div className="aiStats">{profiles.map((p:any)=><article className="panel pad" key={p.id}><span className="eyebrow">PERFIL DE LEITURA</span><h3>{p.profile_name}</h3><p>Versão {p.version} · {p.successful_runs} leituras · confiança {Math.round(Number(p.confidence||0)*100)}%</p><small>{(p.learned_mapping?.price_headers||[]).slice(0,8).join(' · ')||'Ainda aprendendo cabeçalhos'}</small></article>)}</div>
      <div className="reviewFilters"><input aria-label="Buscar proposta" placeholder="Buscar produto ou código…" value={reviewSearch} onChange={e=>setReviewSearch(e.target.value)}/><select aria-label="Filtrar por arquivo" value={documentFilter} onChange={e=>setDocumentFilter(e.target.value)}><option value="">Todos os arquivos</option>{docs.map((d:any)=><option key={d.id} value={d.id}>{d.filename}</option>)}</select><span>{visiblePending.length} de {pending.length} propostas</span></div>
      {selectedIds.size>0&&<div className="bulkReview"><b>{selectedIds.size} selecionado{selectedIds.size>1?'s':''}</b><input value={bulkType} onChange={e=>setBulkType(e.target.value)} placeholder="Tipo/categoria (ex.: Sofá)"/><button onClick={applyBulkType} disabled={!bulkType.trim()||saving}>Aplicar tipo</button><button onClick={()=>setSelectedIds(new Set())}>Limpar seleção</button></div>}
      <section className="panel"><div className="panelHead"><div className="proposalHead"><input type="checkbox" aria-label="Selecionar propostas visíveis" checked={visiblePending.length>0&&visiblePending.every(p=>selectedIds.has(p.id))} onChange={selectAll}/><h2>Propostas para aprovação</h2></div><span>{pending.length} pendentes</span></div>{visiblePending.length===0?<div className="empty">Nenhuma proposta pronta para revisão com estes filtros. Consulte o resultado na aba Arquivos.</div>:visiblePending.map((p:any)=><div className="proposal" key={p.id}><input className="proposalCheck" aria-label={`Selecionar ${p.proposed_data?.name}`} type="checkbox" checked={selectedIds.has(p.id)} onChange={()=>toggleSelected(p.id)}/><div><span className="eyebrow">{p.action==='create'?'NOVO PRODUTO':'ATUALIZAÇÃO'}{p.proposed_data?._human_review?' · CORRIGIDO':''}</span><h3>{p.proposed_data?.name}</h3><p>{p.proposed_data?.supplier_codes?.length||1} códigos · {p.proposed_data?.variant_labels?.length||0} variações · {p.proposed_data?.dimensions?.length||0} medidas · {p.proposed_data?.pricing_groups?.length||0} grupos · {p.proposed_data?.price_count||0} preços</p><small>{p.proposed_data?.product_type?`${p.proposed_data.product_type} · `:''}Confiança: {Math.round(Number(p.confidence||0)*100)}%</small></div><div className="proposalActions"><button onClick={()=>openProposalEditor(p,'source')}>Ver origem</button><button onClick={()=>openProposalEditor(p,'edit')}>Editar</button><button disabled={busy||saving} onClick={()=>reject(p)}>Rejeitar</button><button className="primary" disabled={busy||saving} onClick={()=>approve(p).catch(()=>{})}>Aprovar e aplicar</button></div></div>)}</section></>}

    {editor&&<div className="reviewBg" onMouseDown={e=>{if(e.currentTarget===e.target)setEditor(null)}}><aside className="reviewDrawer" role="dialog" aria-modal="true" aria-label="Revisão da proposta"><div className="reviewHead"><div><span className="eyebrow">REVISÃO ASTRA</span><h2>{editor.proposed_data?.name}</h2><p>{editor.source_locator?.sheet||'Origem não identificada'} · confiança {Math.round(Number(editor.confidence||0)*100)}%</p></div><button onClick={()=>setEditor(null)}>×</button></div><div className="reviewTabs"><button className={editorMode==='edit'?'on':''} onClick={()=>setEditorMode('edit')}>Editar proposta</button><button className={editorMode==='source'?'on':''} onClick={()=>setEditorMode('source')}>Origem e preços</button></div>
      {editorMode==='edit'?<div className="reviewBody"><div className="reviewGrid"><label className="field span2"><span>Nome do produto</span><input value={draft.name||''} onChange={e=>setDraft((d:any)=>({...d,name:e.target.value}))}/></label><label className="field"><span>Tipo / categoria</span><input value={draft.product_type||''} onChange={e=>setDraft((d:any)=>({...d,product_type:e.target.value}))} placeholder="Sofá, Poltrona, Pufe…"/></label><label className="field"><span>Código principal</span><input value={draft.manufacturer_code||''} onChange={e=>setDraft((d:any)=>({...d,manufacturer_code:e.target.value}))}/></label><label className="field span2"><span>Códigos do fornecedor · um por linha</span><textarea rows={4} value={draft.supplier_codes||''} onChange={e=>setDraft((d:any)=>({...d,supplier_codes:e.target.value}))}/></label><label className="field span2"><span>Módulos identificados</span><textarea rows={3} value={draft.modules||''} onChange={e=>setDraft((d:any)=>({...d,modules:e.target.value}))}/></label></div>
        <ChoiceGroup title="Variações que entram no produto" values={draft.all_variant_labels||[]} selected={draft.variant_labels||[]} onToggle={(v:string)=>toggleDraft('variant_labels',v)}/><ChoiceGroup title="Medidas que entram no produto" values={draft.all_dimensions||[]} selected={draft.dimensions||[]} onToggle={(v:string)=>toggleDraft('dimensions',v)}/><ChoiceGroup title="Grupos de preço que entram no produto" values={draft.all_pricing_groups||[]} selected={draft.pricing_groups||[]} onToggle={(v:string)=>toggleDraft('pricing_groups',v)}/><label className="field"><span>Observação da revisão</span><textarea rows={3} value={draft.review_notes||''} onChange={e=>setDraft((d:any)=>({...d,review_notes:e.target.value}))} placeholder="Explique uma correção importante para o Astra aprender depois."/></label></div>:
        <div className="reviewBody"><div className="sourceSummary"><div><span>Planilha</span><b>{editor.source_locator?.sheet||'—'}</b></div><div><span>Códigos</span><b>{(editor.proposed_data?._source_supplier_codes||editor.proposed_data?.supplier_codes||[]).join(', ')||'—'}</b></div><div><span>Linhas carregadas</span><b>{sourceRows.length}</b></div>{docs.find((d:any)=>d.id===editor.source_document_id)&&<button onClick={()=>openOriginal(docs.find((d:any)=>d.id===editor.source_document_id))}>Abrir arquivo original ↗</button>}</div>{loadingSource?<div className="empty">Carregando origem…</div>:<div className="priceReview"><div className="priceReviewHead"><span>Linha</span><span>Código / variação</span><span>Medida</span><span>Grupo</span><span>Preço</span></div>{sourceRows.slice(0,sourceLimit).map((r:any)=><div className="priceReviewRow" key={r.id}><span>{r.row_index}</span><span><b>{r.supplier_product_code}</b><small>{r.source_locator?.variant_label||r.product_name_raw||'—'}</small></span><span>{r.dimension_label||'—'}</span><span>{r.pricing_group||'—'}</span><label><span>R$</span><input aria-label={`Preço da linha ${r.row_index}, ${r.pricing_group||'único'}`} inputMode="decimal" value={draft.price_overrides?.[r.id]??r.price_value??''} onChange={e=>setDraft((d:any)=>({...d,price_overrides:{...(d.price_overrides||{}),[r.id]:e.target.value}}))}/></label></div>)}{sourceLimit<sourceRows.length&&<button onClick={()=>setSourceLimit(n=>n+100)}>Mostrar mais preços ({sourceLimit}/{sourceRows.length})</button>}</div>}</div>}
      <div className="reviewActions"><button onClick={()=>setEditor(null)}>Cancelar</button><button onClick={()=>saveProposalCorrections(false)} disabled={saving||busy||loadingSource}>{saving?'Salvando…':'Salvar correções'}</button><button className="primary" onClick={()=>saveProposalCorrections(true)} disabled={saving||busy||loadingSource}>{saving?'Salvando…':'Salvar e aprovar'}</button></div></aside></div>}
  </>
}

function ChoiceGroup({title,values,selected,onToggle}:{title:string,values:string[],selected:string[],onToggle:(v:string)=>void}){if(!values?.length)return null;return <div className="choiceGroup"><div className="choiceTitle"><b>{title}</b><span>{selected.length}/{values.length}</span></div><div className="choiceList">{values.map(v=><label key={v}><input type="checkbox" checked={selected.includes(v)} onChange={()=>onToggle(v)}/><span>{v}</span></label>)}</div></div>}
function Info({label,value}:{label:string,value:any}){return <div className="info"><span>{label}</span><b>{value||'—'}</b></div>}
function Kpi({label,value}:{label:string,value:any}){return <article><span>{label}</span><strong>{value}</strong></article>}
function SectionTitle({title,text,action,onAction}:{title:string,text:string,action?:string,onAction?:()=>void}){return <div className="sectionAction"><div><h2>{title}</h2><p className="muted">{text}</p></div>{action&&<button className="primary" onClick={onAction}>{action}</button>}</div>}
