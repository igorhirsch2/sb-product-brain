import './globals.css'

export const metadata = {
  title: 'SB Product Brain',
  description: 'Inteligência de produto do Grupo SB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
