'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BookOpenText, ClipboardCheck, FileText, Gauge, LayoutDashboard, LogOut, Menu, Moon, PenLine, ServerCog, ShieldCheck, Sparkles, Sun, UserRound, type LucideIcon } from 'lucide-react'
import { LangToggle, useT } from './Lang'

export type NavGroup = { group: string; items: { href: string; label: string; count?: number }[] }

const ICON: Record<string, LucideIcon> = {
  '/overview': LayoutDashboard, '/review': ClipboardCheck, '/reports': FileText, '/trust': Gauge, '/privacy': ShieldCheck,
  '/system': ServerCog, '/about': Sparkles, '/glossary': BookOpenText, '/me': UserRound, '/write': PenLine,
}

export function Mark({ size = 20 }: { size?: number }) {
  // altimeter needle over a horizon: progress toward a target
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 15.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
      <path d="M12 12 16.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}

export function Shell({ nav, me, signOut, children }: {
  nav: NavGroup[]
  me: { name: string; scope: string }
  signOut: () => Promise<void>
  children: React.ReactNode
}) {
  const path = usePathname()
  const { t, lang } = useT()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('alt-theme')
      if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved
    } catch {}
  }, [])

  const toggleTheme = () => {
    const root = document.documentElement
    const now = root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const next = now === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try { localStorage.setItem('alt-theme', next) } catch {}
  }

  const active = (href: string) => path === href || path.startsWith(`${href}/`)
  // detail pages have no menu entry of their own: show the section they belong to
  const section = path.startsWith('/cohorts') || path.startsWith('/learners') ? '/overview' : path.startsWith('/essays') ? (nav.some(g => g.items.some(i => i.href === '/review')) ? '/review' : '/me') : path
  const current = nav.flatMap(g => g.items).find(i => active(i.href) || i.href === section)

  return (
    <div className="app">
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 45 }} />}
      <aside className={`rail${open ? ' open' : ''}`} aria-label={t('Navigasi', 'Navigation')}>
        <Link href="/" className="rail-brand" style={{ color: 'var(--ink)', textDecoration: 'none' }}>
          <span className="mark"><Mark /></span>
          <div>
            <div className="product">Altimeter</div>
            <div className="sub">{t('Kesiapan & kepercayaan skor', 'Readiness & score trust')}</div>
          </div>
        </Link>
        <nav>
          {nav.map(g => (
            <div key={g.group}>
              <div className="group">{g.group}</div>
              {g.items.map(i => {
                const Icon = ICON[i.href]
                return (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={`nav-item${active(i.href) || i.href === section ? ' is-active' : ''}`}>
                  {Icon && <Icon size={16} strokeWidth={1.8} aria-hidden />}{i.label}{i.count != null && <span className="count">{i.count.toLocaleString(lang === 'en' ? 'en-GB' : 'id-ID')}</span>}
                </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          {t('Data demo sintetis', 'Synthetic demo data')}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setOpen(true)} aria-label={t('Buka menu', 'Open menu')}><Menu size={16} /></button>
          <span className="crumb">{current?.label ?? 'Altimeter'}</span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} aria-label={t('Ganti tema terang atau gelap', 'Switch light or dark theme')} title={t('Ganti tema', 'Switch theme')}>
            <Sun size={15} className="when-dark" /><Moon size={15} className="when-light" />
          </button>
          <span className="small hide-xs" style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <span className="strong">{me.name}</span><br />
            <span className="muted">{me.scope}</span>
          </span>
          <form action={signOut}>
            <button className="btn btn-sm" aria-label={t('Keluar', 'Sign out')} title={t('Keluar', 'Sign out')}><LogOut size={14} /></button>
          </form>
          <LangToggle />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
