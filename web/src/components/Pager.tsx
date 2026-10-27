import Link from 'next/link'
import { tr } from '@/lib/i18n'
import { num } from '@/lib/format'

export const PER_PAGE = [15, 30, 50] as const

function pageWindow(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter(x => x >= 1 && x <= pages))
  const out: (number | '…')[] = []
  let prev = 0
  for (const x of [...keep].sort((a, b) => a - b)) {
    if (x - prev > 1) out.push('…')
    out.push(x)
    prev = x
  }
  return out
}

// URL-based pager: range, rows per page, page numbers with ellipsis.
export function LinkPager({ page, total, size, href, perHref }: {
  page: number; total: number; size: number; href: (page: number) => string; perHref?: (per: number) => string
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(total, page * size)
  const off = { opacity: .45, pointerEvents: 'none' as const }
  return (
    <div className="table-foot">
      <div className="row" style={{ gap: 14 }}>
        <span>{num(from)}-{num(to)} {tr('dari', 'of')} {num(total)}</span>
        {perHref && total > PER_PAGE[0] && (
          <nav className="seg seg-sm" aria-label={tr('Baris per halaman', 'Rows per page')}>
            {PER_PAGE.map(x => <Link key={x} href={perHref(x)} className={x === size ? 'on' : undefined}>{x}</Link>)}
          </nav>
        )}
      </div>
      {pages > 1 && (
        <nav className="row pages" aria-label={tr('Halaman', 'Pages')} style={{ gap: 4 }}>
          <Link className="btn btn-sm" href={href(page - 1)} aria-disabled={page <= 1} style={page <= 1 ? off : undefined}>{tr('Sebelumnya', 'Previous')}</Link>
          {pageWindow(page, pages).map((x, i) => x === '…'
            ? <span key={`e${i}`} className="page-gap" aria-hidden>…</span>
            : <Link key={x} href={href(x)} className={`btn btn-sm page-n${x === page ? ' on' : ''}`} aria-current={x === page ? 'page' : undefined}>{num(x)}</Link>)}
          <Link className="btn btn-sm" href={href(page + 1)} aria-disabled={page >= pages} style={page >= pages ? off : undefined}>{tr('Berikutnya', 'Next')}</Link>
        </nav>
      )}
    </div>
  )
}
