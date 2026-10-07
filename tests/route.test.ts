import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST } from '../app/api/process-document/route'

// Use the real Supabase client against an isolated HTTP double. No network or real records.
async function scenario(mode:'success'|'missing'|'running'|'complete'|'partial'){
  const previousFetch=globalThis.fetch
  const previousUrl=process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const calls:{table:string,method:string,body:any,query:URLSearchParams}[]=[]
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://import-test.invalid'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-key'
  globalThis.fetch=async(input:any,init?:RequestInit)=>{
    const url=new URL(String(input)),method=init?.method||'GET'
    assert.equal(url.hostname,'import-test.invalid')
    const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
    if(url.pathname==='/auth/v1/user')return json({id:'test-user',aud:'authenticated'})
    if(url.pathname.startsWith('/storage/'))return new Response('Código;Descrição;Preço\nAB123;Mesa;1234,56')
    const table=url.pathname.split('/').pop()!
    const body=init?.body?JSON.parse(String(init.body)):null
    calls.push({table,method,body,query:url.searchParams})
    if(method==='GET'){
      if(table==='ingestion_jobs')return mode==='missing'?json({message:'not found'},406):json({id:'job',status:mode==='complete'?'review':mode==='running'?'processing':'queued',extraction_summary:{products_detected:1}})
      if(table==='source_documents')return json({id:'doc',brand_id:'brand',filename:'tabela.csv',document_type:'price_table',price_basis:'cost',storage_path:'synthetic.csv'})
      if(table==='brands')return json({id:'brand'})
      return json([])
    }
    if(table==='ingestion_jobs'&&body?.status==='processing')return json(mode==='running'?[]:[{id:'job'}])
    if(table==='change_proposals'&&method==='POST'&&mode==='partial')return json({message:'falha simulada ao salvar propostas'},400)
    return new Response(null,{status:204})
  }
  try{
    const request=new NextRequest('http://localhost/api/process-document',{method:'POST',headers:{authorization:'Bearer synthetic-token','content-type':'application/json'},body:JSON.stringify({documentId:'doc',jobId:'job'})})
    const response=await POST(request)
    return {status:response.status,body:await response.json(),calls}
  }finally{
    globalThis.fetch=previousFetch
    if(previousUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previousUrl
    if(previousKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=previousKey
  }
}

test('API valida vínculo entre documento e job antes de escrever',async()=>{
  const result=await scenario('missing')
  assert.equal(result.status,404)
  assert.ok(result.calls.every(c=>c.method==='GET'))
  assert.equal(result.calls[0].query.get('source_document_id'),'eq.doc')
})
test('API bloqueia processamento duplicado e retorna conclusão anterior',async()=>{
  const running=await scenario('running')
  assert.equal(running.status,409)
  assert.equal(running.calls.filter(c=>c.method!=='GET').length,1)
  const claim=running.calls.find(c=>c.method==='PATCH')!
  assert.equal(claim.query.get('status'),'eq.queued')
  assert.equal(claim.query.get('parser_type'),'eq.astra_pending_v5')
  const complete=await scenario('complete')
  assert.equal(complete.status,200)
  assert.ok(complete.calls.every(c=>c.method==='GET'))
})
test('API só libera revisão depois de persistir o arquivo atual',async()=>{
  const result=await scenario('success')
  assert.equal(result.status,200,JSON.stringify(result.body))
  assert.equal(result.body.summary.prices_detected,1)
  const rows=result.calls.find(c=>c.table==='extraction_rows'&&c.method==='POST')!
  assert.equal(rows.body[0].price_value,1234.56)
  assert.equal(rows.body[0].status,'needs_review')
  assert.equal(result.calls.at(-1)?.body.status,'review')
})
test('API invalida extração parcial sem DELETE nem recuperação histórica',async()=>{
  const result=await scenario('partial')
  assert.equal(result.status,500)
  assert.match(result.body.error,/falha simulada/)
  for(const table of ['change_proposals','extraction_rows'])assert.ok(result.calls.some(c=>c.table===table&&c.method==='PATCH'&&c.body.status==='rejected'))
  assert.ok(!result.calls.some(c=>c.method==='DELETE'))
  assert.equal(result.calls.filter(c=>c.table==='ingestion_jobs'&&c.method==='GET').length,1)
  assert.equal(result.calls.at(-1)?.body.status,'error')
})
