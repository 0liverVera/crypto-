import type { ReactNode } from 'react'

/** A micro tracked-caps section label with an optional right-aligned slot.
 *  Set in the body grotesque — small caps read cleaner here than in the serif. */
export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-micro uppercase tracking-[0.16em] text-ink-faint font-medium">
        {children}
      </span>
      {right}
    </div>
  )
}
