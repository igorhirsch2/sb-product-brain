import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { learnSupplierProfile, parseSupplierWorkbook } from '@/lib/astra-server'
import { queryAll } from '@/lib/queryAll'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req:NextRequest){
  const auth=req.headers.get('authorization')
  if(!auth?.startsWith('Bearer '))return NextResponse.json({error:'Sessão ausente.'},{status:401})
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if(!url||!key)return NextResponse.json({error:'Supabase não configurado.'},{status:500})
  const supabase=createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const {data:userData,error:userError}=await supabase.auth.getUser(auth.slice(7))
  if(userError||!userData.user)return NextResponse.json({error:'Sessão inválida.'},{status:401})
  const body=await req.json().catch(()=>null)
  if(!body||typeof body.documentId!=='string'||typeof body.jobId!=='string')return NextResponse.json({error:'Documento ou processamento inválido.'},{status:400})
  const {documentId,jobId}=body
  let claimed=false
  try{
    const job=await supabase.from('ingestion_jobs').select('*').eq('id',jobId).eq('source_document_id',documentId).single()
    if(job.error||!job.data)return NextResponse.json({error:'Processamento não encontrado para este documento.'},{status:404})
    if(job.data.status==='review')return NextResponse.json({ok:true,summary:job.data.extraction_summary,proposals:job.data.extraction_summary?.products_detected||0})
    // Claim once. Concurrent/repeated requests cannot write another extraction for this job.
    const claim=await supabase.from('ingestion_jobs').update({status:'processing',parser_type:'astra_server_v5',started_at:new Date().toISOString(),error_message:null})
      .eq('id',jobId).eq('source_document_id',documentId).eq('status','queued').eq('parser_type','astra_pending_v5').select('id').maybeSingle()
    if(claim.error)throw claim.error
    if(!claim.data)return NextResponse.json({error:'Este processamento já foi iniciado. Atualize os arquivos para acompanhar o resultado.'},{status:409})
    claimed=true
    const {data:document,error:docErr}=await supabase.from('source_documents').select('*').eq('id',documentId).single();if(docErr)throw docErr
    const ext=(document.filename.split('.').pop()||'').toLowerCase()
    if(!['xlsx','xls','csv'].includes(ext))throw new Error('A leitura automática aceita Excel e CSV. PDF fica disponível como arquivo de consulta.')
    if(document.document_type!=='price_table')throw new Error('A leitura automática está disponível para tabelas de preços. Os demais documentos ficam disponíveis para consulta.')
    if(!['cost','sale'].includes(document.price_basis))throw new Error('Defina se os preços são de custo ou venda antes de importar.')
    const {data:brand,error:brandErr}=await supabase.from('brands').select('*').eq('id',document.brand_id).single();if(brandErr)throw brandErr
    const [products,profiles]=await Promise.all([
      queryAll((from,to)=>supabase.from('products').select('*').eq('brand_id',brand.id).order('id').range(from,to)),
      supabase.from('supplier_ai_profiles').select('*').eq('brand_id',brand.id).eq('document_type',document.document_type).eq('is_active',true).order('updated_at',{ascending:false}).limit(1)
    ])
    if(profiles.error)throw profiles.error
    const state=await supabase.from('source_documents').update({status:'processing',approval_status:'pending'}).eq('id',documentId);if(state.error)throw state.error
    const dl=await supabase.storage.from(document.storage_bucket||'supplier-tables').download(document.storage_path);if(dl.error)throw dl.error
    if(dl.data.size>20*1024*1024)throw new Error('O arquivo excede 20 MB. Divida a tabela em arquivos menores.')
    // Never replace a failed extraction with prices from an older file of the same name.
    const result=await parseSupplierWorkbook(dl.data,{supabase,brand,document,jobId,products,aiProfile:profiles.data?.[0]||null})
    // A failed profile update must not turn a completed extraction into a failed job.
    try{await learnSupplierProfile(supabase,brand.id,document.document_type,result.summary,profiles.data?.[0]||null)}
    catch{result.summary.warnings.push('Extração concluída; não foi possível atualizar o perfil de leitura.')}
    const sd=await supabase.from('source_documents').update({status:'review',approval_status:'review'}).eq('id',documentId);if(sd.error)throw sd.error
    const done=await supabase.from('ingestion_jobs').update({status:'review',completed_at:new Date().toISOString(),total_rows:result.rows.length,matched_rows:result.rows.filter((x:any)=>x.product_id).length,review_rows:result.rows.length,extraction_summary:result.summary,error_message:null}).eq('id',jobId);if(done.error)throw done.error
    return NextResponse.json({ok:true,summary:result.summary,proposals:result.proposals.length})
  }catch(e:any){
    let msg=e?.message||String(e)
    if(claimed){
      // Retain failed rows for audit. UPDATE is allowed to importers whose RLS forbids DELETE.
      const props=await supabase.from('change_proposals').update({status:'rejected',review_notes:'Extração interrompida; proposta não aplicável.'}).eq('job_id',jobId).eq('status','pending')
      const rows=await supabase.from('extraction_rows').update({status:'rejected'}).eq('job_id',jobId).eq('status','needs_review')
      if(props.error||rows.error)msg+=' Não foi possível invalidar a extração parcial; revise o processamento antes de tentar novamente.'
      await supabase.from('ingestion_jobs').update({status:'error',completed_at:new Date().toISOString(),error_message:msg}).eq('id',jobId)
      await supabase.from('source_documents').update({status:'error',approval_status:'pending'}).eq('id',documentId)
    }
    return NextResponse.json({error:msg},{status:500})
  }
}
