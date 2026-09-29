import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { learnSupplierProfile, parseSupplierWorkbook } from '@/lib/astra-server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req:NextRequest){
  const auth=req.headers.get('authorization')
  if(!auth?.startsWith('Bearer '))return NextResponse.json({error:'Sessão ausente.'},{status:401})
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if(!url||!key)return NextResponse.json({error:'Supabase não configurado.'},{status:500})
  const supabase=createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const {data:userData,error:userError}=await supabase.auth.getUser(auth.replace('Bearer ',''))
  if(userError||!userData.user)return NextResponse.json({error:'Sessão inválida.'},{status:401})

  const body=await req.json().catch(()=>({}))
  const documentId=body.documentId as string|undefined,jobId=body.jobId as string|undefined
  if(!documentId||!jobId)return NextResponse.json({error:'Documento/job ausente.'},{status:400})

  try{
    const {data:document,error:docErr}=await supabase.from('source_documents').select('*').eq('id',documentId).single();if(docErr)throw docErr
    const {data:brand,error:brandErr}=await supabase.from('brands').select('*').eq('id',document.brand_id).single();if(brandErr)throw brandErr
    const [{data:products,error:prodErr},{data:profiles,error:profileErr}]=await Promise.all([
      supabase.from('products').select('*').eq('brand_id',brand.id),
      supabase.from('supplier_ai_profiles').select('*').eq('brand_id',brand.id).eq('document_type',document.document_type).eq('is_active',true).order('updated_at',{ascending:false}).limit(1)
    ])
    if(prodErr)throw prodErr;if(profileErr)throw profileErr

    await supabase.from('ingestion_jobs').update({status:'processing',started_at:new Date().toISOString(),error_message:null,parser_type:'astra_server_v3'}).eq('id',jobId)
    await supabase.from('source_documents').update({status:'processing',approval_status:'pending'}).eq('id',documentId)

    const dl=await supabase.storage.from(document.storage_bucket||'supplier-tables').download(document.storage_path);if(dl.error)throw dl.error
    const ext=(document.filename.split('.').pop()||'').toLowerCase()
    if(!['xlsx','xls','csv'].includes(ext))throw new Error('Nesta versão, a interpretação automática concluída é para Excel/CSV. O documento permanece armazenado para o parser semântico.')

    const result=await parseSupplierWorkbook(dl.data,{supabase,brand,document,jobId,products:products||[],aiProfile:profiles?.[0]||null})
    const done=await supabase.from('ingestion_jobs').update({status:'review',completed_at:new Date().toISOString(),total_rows:result.rows.length,matched_rows:result.rows.filter((x:any)=>x.product_id).length,review_rows:result.rows.length,extraction_summary:result.summary,error_message:null}).eq('id',jobId);if(done.error)throw done.error
    const sd=await supabase.from('source_documents').update({status:'review',approval_status:'review'}).eq('id',documentId);if(sd.error)throw sd.error
    await learnSupplierProfile(supabase,brand.id,document.document_type,result.summary,profiles?.[0]||null)
    return NextResponse.json({ok:true,summary:result.summary,proposals:result.proposals.length})
  }catch(e:any){
    const msg=e?.message||String(e)
    await supabase.from('ingestion_jobs').update({status:'error',completed_at:new Date().toISOString(),error_message:msg}).eq('id',jobId)
    await supabase.from('source_documents').update({status:'error',approval_status:'pending'}).eq('id',documentId)
    return NextResponse.json({error:msg},{status:500})
  }
}
