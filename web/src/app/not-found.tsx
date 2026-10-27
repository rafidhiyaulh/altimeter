import Link from 'next/link'
import { Compass } from 'lucide-react'
import { getT } from '@/lib/i18n-server'

export default async function NotFound() {
  const { t } = await getT()
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="card max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><Compass size={20} strokeWidth={1.8} /></div>
        <h1 className="text-lg font-semibold">{t('Halaman tidak ditemukan', 'Page not found')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('Mungkin sudah dihapus, atau di luar akses Anda.', 'It may have been removed, or is outside your access.')}</p>
        <Link href="/" className="btn btn-primary mt-5 inline-flex">{t('Kembali', 'Go back')}</Link>
      </div>
    </div>
  )
}
