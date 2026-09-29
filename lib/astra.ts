import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnyRow } from './utils'

export type ParseContext = {
  supabase: SupabaseClient
  brand: AnyRow
  document: AnyRow
  jobId: string
  products: AnyRow[]
  aiProfile?: AnyRow | null
}

export async function parseSupplierWorkbook(_file:Blob,ctx:ParseContext){
  const {supabase,document,jobId}=ctx
  const {data:{session}}=await supabase.auth.getSession()
  if(!session)throw new Error('Sua sessão expirou. Entre novamente.')

  const response=await fetch('/api/process-document',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({documentId:document.id,jobId})
  })
  const body=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(body.error||'Falha ao processar o arquivo no servidor.')

  const total=Number(body.summary?.prices_detected||0)
  const matched=Number(body.summary?.matched||0)
  const rows=Array.from({length:total},(_,i)=>({product_id:i<matched?'matched':null}))
  return {rows,proposals:Array.from({length:Number(body.proposals||0)}),summary:body.summary||{}}
}

export async function learnSupplierProfile(_supabase:SupabaseClient,_brandId:string,_docType:string,_summary:any,_existing?:AnyRow|null){
  // O aprendizado é persistido pelo parser do servidor.
  return
}
