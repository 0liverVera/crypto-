import type { ReactNode } from 'react'

/** A bordered terminal panel with an optional label header. */
export function Panel({
  label,
  right,
  children,
  className = '',
}: {
  label?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`border border-line bg-panel rounded-[--radius] ${className}`}
    >
      {label && (
        <header className="flex items-center justify-between px-3 py-2 border-b border-line">
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            {label}
          </span>
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  )
}
