import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn Card (compound), on the Modern Minimal tokens.
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('flex flex-col gap-5 rounded-xl border bg-card py-5 text-card-foreground shadow-sm', className)} {...props} />
}
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('grid auto-rows-min items-start gap-1 px-5', className)} {...props} />
}
export function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
}
export function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}
export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}
