import Image from 'next/image'
import { cn } from '@/lib/utils'

// Photo card adapted from the 21st.dev testimonial card: rounded-2xl, image on top with a hover zoom and a
// gradient fade into a dark body, a one-line statement and a label. Theme fonts, no external CSS.
export function FeatureCard({ src, alt, title, text, label, className }: {
  src: string; alt: string; title: string; text: string; label: string; className?: string
}) {
  return (
    <figure className={cn('group overflow-hidden rounded-2xl bg-neutral-950 text-white shadow-lg ring-1 ring-black/5', className)}>
      <div className="relative -mt-px overflow-hidden rounded-2xl">
        <Image src={src} alt={alt} width={720} height={540} sizes="(max-width: 1100px) 60vw, 220px"
          className="h-[150px] w-full rounded-2xl object-cover transition-transform duration-300 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-neutral-950 to-transparent" />
      </div>
      <figcaption className="px-4 pb-4">
        <p className="border-b border-white/15 pb-3 text-[13.5px] font-medium leading-snug">{title}</p>
        <p className="mt-3 text-[12.5px] leading-snug text-white/70">{text}</p>
        <p className="mt-1 text-[12px] font-semibold text-[#93C5FD]">{label}</p>
      </figcaption>
    </figure>
  )
}
