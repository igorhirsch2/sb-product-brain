import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseSupplierWorkbook } from '../lib/astra-server'
import { numberValue, parseDimensions } from '../lib/utils'

function workbook(rows:any[][]){
  const wb=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Tabela')
  return new Blob([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})])
}
function mockDb(){
  const writes:Record<string,any[]>={}
  const db:any={from(table:string){const q:any={select(){return q},eq(){return q},neq(){return q},gt(){return q},order(){return q},limit(){return q},range(){return q},insert(rows:any){writes[table]=[...(writes[table]||[]),...(Array.isArray(rows)?rows:[rows])];return Promise.resolve({error:null})},then(resolve:any){return Promise.resolve({data:[],error:null}).then(resolve)}};return q}}
  return {db,writes}
}
async function parse(rows:any[][]){const {db,writes}=mockDb();const result=await parseSupplierWorkbook(workbook(rows),{supabase:db,brand:{id:'brand'},document:{id:'doc',price_basis:'cost'},jobId:'job',products:[]});return {result,writes}}

test('não transforma texto e medidas em preços',()=>{
  assert.equal(numberValue('Módulo 300'),null)
  assert.equal(numberValue('200 x 90'),null)
  assert.equal(numberValue('R$ 1.234,56'),1234.56)
})
test('respeita unidades explícitas de medida',()=>{
  assert.deepEqual(parseDimensions('2,00 x 0,90 x 0,80 m'),{width_mm:2000,depth_mm:900,height_mm:800,dimension_label:'2,00 x 0,90 x 0,80 m'})
  assert.equal(parseDimensions('900 x 800 x 700 mm').width_mm,900)
})
test('aceita SKU simples, código numérico e preços abaixo de R$50',async()=>{
  const {result}=await parse([['Código','Descrição','Preço'],['AB123','Vaso',49.9],['001','Copo',15]])
  assert.equal(result.rows.length,2)
  assert.equal(result.rows[0].price_value,49.9)
  assert.equal(result.rows[1].supplier_product_code,'001')
})
test('preserva primeira linha, grupo nomeado e status válido',async()=>{
  const {result}=await parse([['Código','Descrição','Preço'],['100.123','Poltrona',1500]])
  assert.equal(result.rows.length,1)
  assert.equal(result.rows[0].product_name_raw,'Poltrona')
  assert.equal(result.rows[0].status,'needs_review')
})
test('não limita silenciosamente a oito grupos de preço',async()=>{
  const {result}=await parse([['Código','Descrição',...Array.from({length:10},(_,i)=>`Preço grupo ${i+1}`)],['100.123','Sofá',...Array.from({length:10},(_,i)=>1000+i*100)]])
  assert.equal(result.rows.length,10)
})
test('não adivinha preço a partir de colunas de medidas',async()=>{
  await assert.rejects(parse([['Código','Descrição','Peso','Volume'],...Array.from({length:6},(_,i)=>[`100.12${i}`,'Sofá',200,300])]),/preço|preco|confiáveis/i)
})

test('cabeçalhos em duas linhas com grupos mesclados preservam todos os preços',async()=>{
  const {db}=mockDb(), wb=XLSX.utils.book_new()
  const sheet=XLSX.utils.aoa_to_sheet([['Código','Descrição','Preço por grupo','',''],['','','A','B','C'],['AB123','Sofá',1000,1200,1400]])
  sheet['!merges']=[{s:{r:0,c:2},e:{r:0,c:4}}]
  XLSX.utils.book_append_sheet(wb,sheet,'Preços')
  const result=await parseSupplierWorkbook(new Blob([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})]),{supabase:db,brand:{id:'brand'},document:{id:'doc',price_basis:'cost'},jobId:'job',products:[]})
  assert.equal(result.rows.length,3)
  assert.deepEqual(result.rows.map(r=>r.pricing_group),['Preço por grupo · A','Preço por grupo · B','Preço por grupo · C'])
})

test('informa abas ignoradas em importações parciais',async()=>{
  const {db}=mockDb(), wb=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Código','Descrição','Preço'],['A1','Mesa',1200]]),'Produtos')
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Condições'],['Entrega em 30 dias']]),'Condições')
  const result=await parseSupplierWorkbook(new Blob([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})]),{supabase:db,brand:{id:'brand'},document:{id:'doc',price_basis:'cost'},jobId:'job',products:[]})
  assert.equal(result.rows.length,1)
  assert.deepEqual(result.summary.skipped_sheets,['Condições'])
  assert.equal(result.summary.warnings.length,1)
})

test('falha de persistência é propagada sem reutilizar extração histórica',async()=>{
  const {db}=mockDb(), from=db.from.bind(db)
  db.from=(table:string)=>{
    assert.notEqual(table,'ingestion_jobs','não deve buscar preços de outro processamento')
    const q=from(table)
    if(table==='extraction_rows')q.insert=()=>Promise.resolve({error:new Error('constraint simulada')})
    return q
  }
  await assert.rejects(parseSupplierWorkbook(workbook([['Código','Descrição','Preço'],['A1','Mesa',1200]]),{supabase:db,brand:{id:'brand'},document:{id:'doc',price_basis:'cost'},jobId:'job',products:[]}),/constraint simulada/)
})

test('CSV com separador ponto e vírgula e preço brasileiro',async()=>{
  const {db}=mockDb()
  const result=await parseSupplierWorkbook(new Blob(['Código;Descrição;Preço\nAB123;Mesa;"1.234,56"']),{supabase:db,brand:{id:'brand'},document:{id:'doc',price_basis:'cost'},jobId:'job',products:[]})
  assert.equal(result.rows[0].price_value,1234.56)
})
