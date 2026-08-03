import type { ReactNode } from 'react'

type BadgeTone = 'violet' | 'gray' | 'blue' | 'green' | 'amber' | 'red'

const TONES: Record<BadgeTone, string> = {
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
}

export function Badge({
  children,
  tone = 'violet',
  className = '',
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      {icon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100 text-gray-400">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-gray-700">{title}</h3>
      {description && <p className="max-w-xs text-sm text-gray-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200/70 ${className}`} />
}
