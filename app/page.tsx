'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type Brand = { id: string; name: string }
type Product = { id: string; internal_code?: string | null; name: string; status?: string | null; brand_id?: string | null }

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  return url && key ? createClient(url, key) : null
}

export default function Home() {
  const supabase = useMemo(() => getSupabase(), [])
  const [session, setSession] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [active, setActive] = useState<'catalogo'|'fornecedores'>('catalogo')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [supabase])

  useEffect(() => {
    if (!session || !supabase) return
    Promise.all([
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('products').select('id,internal_code,name,status,brand_id').order('name').limit(200),
    ]).then(([b,p]) => {
      setBrands((b.data || []) as Brand[])
      setProducts((p.data || []) as Product[])
    })
  }, [session, supabase])

  async function login(e: React.FormEvent) {
    e.preventDefault(); setMessage('Entrando...')
    if (!supabase) return setMessage('Configuração do Supabase ainda não foi adicionada na Vercel.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setMessage(error ? error.message : '')
  }

  if (!session) return <main className="login"><div className="loginCard"><div className="logo">SB</div><p className="eyebrow">GRUPO SB</p><h1>Product Brain</h1><p className="muted">Inteligência central de produtos, fornecedores e tabelas.</p><form onSubmit={login}><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label><button>Entrar</button></form>{message && <p className="message">{message}</p>}</div></main>

  const brandName = (id?: string|null) => brands.find(b=>b.id===id)?.name || 'Sem fornecedor'

  return <div className="shell"><aside><div className="sideBrand"><div className="logo small">SB</div><div><b>Product Brain</b><small>Grupo SB</small></div></div><nav><button className={active==='catalogo'?'on':''} onClick={()=>setActive('catalogo')}>Catálogo</button><button className={active==='fornecedores'?'on':''} onClick={()=>setActive('fornecedores')}>Fornecedores / Marcas</button><span>Curadoria</span><span>Inteligência</span></nav><div className="sideBottom"><small>{session.user.email}</small><button onClick={()=>supabase?.auth.signOut()}>Sair</button></div></aside><main className="content">
    {active==='catalogo' ? <><header><div><p className="eyebrow">PRODUCT BRAIN</p><h1>Catálogo</h1><p className="muted">Base central de produtos do Grupo SB.</p></div><button className="primary">+ Novo produto</button></header><div className="stats"><article><span>Produtos</span><strong>{products.length}</strong></article><article><span>Fornecedores</span><strong>{brands.length}</strong></article><article><span>Ativos</span><strong>{products.filter(p=>p.status==='active').length}</strong></article></div><section className="panel"><div className="panelHead"><h2>Produtos</h2><span>{products.length} registros</span></div><div className="table">{products.map(p=><div className="row" key={p.id}><div><b>{p.name}</b><small>{p.internal_code || p.id}</small></div><span>{brandName(p.brand_id)}</span><span className="pill">{p.status || 'draft'}</span><button>Abrir</button></div>)}</div></section></> : <><header><div><p className="eyebrow">ESTRUTURA</p><h1>Fornecedores / Marcas</h1><p className="muted">Cadastro, arquivos, condições comerciais, promoções e inteligência por fornecedor.</p></div><button className="primary">+ Novo fornecedor</button></header><div className="brandGrid">{brands.map(b=><article className="brandCard" key={b.id}><div className="brandInitial">{b.name.slice(0,2).toUpperCase()}</div><div><h2>{b.name}</h2><p>{products.filter(p=>p.brand_id===b.id).length} produtos</p></div><button>Abrir ficha</button></article>)}</div></>}
  </main></div>
}
