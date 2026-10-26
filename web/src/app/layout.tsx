import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { LangProvider } from '@/components/Lang'
import { getLang } from '@/lib/i18n-server'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '600'], display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Altimeter', template: '%s' },
  description: 'Readiness and score-trust console for English test-prep institutions',
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang()
  return (
    <html lang={lang} className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body><LangProvider lang={lang}>{children}</LangProvider></body>
    </html>
  )
}
