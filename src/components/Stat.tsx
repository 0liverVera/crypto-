import { pct } from '../lib/format'

/** A labeled metric with an optional signed delta, tabular figures. */
export function Stat({
  label,
  value,
  delta,
}: {
  label: string
  value: string
  delta?: number
}) {
  const up = delta != null && delta >= 0
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </span>
      <span className="text-lg leading-none tnum text-ink">{value}</span>
      {delta != null && (
        <span
          className={`text-xs tnum ${up ? 'text-up' : 'text-down'}`}
        >
          {pct(delta)}
        </span>
      )}
    </div>
  )
}
