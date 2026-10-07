import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceOverrides, selectProposalRows } from '../lib/proposalReview'
import { queryAll } from '../lib/queryAll'
import { applyProductProposal } from '../lib/applyProposal'

const source={id:'row',row_index:2,supplier_product_code:'AB-12',product_name_raw:'Mesa',price_value:1000,dimension_label:null,pricing_group:'A',source_locator:{variant_label:'Mesa'}}
test('correções monetárias aceitam BRL e rejeitam valores inválidos',()=>{
  assert.deepEqual(priceOverrides({row:'1.234,56'}),{row:1234.56})
  for(const price of ['abc','Infinity',-1,0,'1x2'])assert.throws(()=>priceOverrides({row:price}))
})
test('salvar produto sem dimensões mantém seus preços',()=>{
  assert.equal(selectProposalRows([source],{supplier_codes:['AB-12'],included_dimensions:[]}).length,1)
})
test('desmarcar todos os grupos impede aprovação',()=>{
  assert.throws(()=>selectProposalRows([source],{supplier_codes:['AB-12'],included_pricing_groups:[]}),/Nenhum preço/)
})
test('códigos com pontuação diferente não se confundem por nome',()=>{
  const rows=selectProposalRows([source,{...source,id:'another',supplier_product_code:'AB.12'}],{name:'Mesa',supplier_codes:['AB-12']})
  assert.equal(rows.length,1)
})
test('origem permanece vinculada depois de renomear produto e código',()=>{
  assert.equal(selectProposalRows([source],{name:'Mesa nova',supplier_codes:['NOVO'],_source_supplier_codes:['AB-12']}).length,1)
})
test('paginação lê mais de mil linhas e propaga falhas',async()=>{
  const data=Array.from({length:1501},(_,id)=>({id}))
  const rows=await queryAll(async(from,to)=>({data:data.slice(from,to+1),error:null}))
  assert.equal(rows.length,1501)
  await assert.rejects(queryAll(async()=>({data:null,error:new Error('falha de rede')})),/falha de rede/)
})
test('aprovação inválida não escreve produto nem código',async()=>{
  const proposal={id:'proposal',status:'pending',source_document_id:'doc',brand_id:'brand',job_id:'job',proposed_data:{name:'Mesa',supplier_codes:['AB-12'],included_pricing_groups:[]}}
  const writes:any[]=[]
  const db:any={from(table:string){const q:any={select(){return q},eq(){return q},order(){return q},range(){return q},single(){return q},insert(v:any){writes.push(v);return q},update(v:any){writes.push(v);return q},upsert(v:any){writes.push(v);return q},then(resolve:any){return Promise.resolve({data:table==='change_proposals'?proposal:table==='ingestion_jobs'?{status:'review'}:table==='source_documents'?{id:'doc',brand_id:'brand',price_basis:'cost'}:[source],error:null}).then(resolve)}};return q}}
  await assert.rejects(applyProductProposal({supabase:db,proposal,brand:{id:'brand'},userId:'user'}),/Nenhum preço/)
  assert.equal(writes.length,0)
})
