import { pct } from '../lib/format'

interface MetaCell {
  label: string
  value: string
  tone?: 'up' | 'down'
}

/** THE STATEMENT — the signature element.
 *  One oversized tabular figure set on hairline rules with a Fraunces label,
 *  like a private-bank statement. The number is the interface. */
export function Statement({
  label,
  value,
  delta,
  meta,
}: {
  label: string
  value: string
  delta?: number
  meta: MetaCell[]
}) {
  const up = delta != null && delta >= 0
  return (
    <section className="bg-surface border border-hairline rounded-lg px-6 pt-6 pb-5">
      <span className="font-display text-fine text-ink-soft tracking-tight">{label}</span>

      <div className="mt-3">
        <div className="font-data tnum text-[clamp(2.2rem,11vw,3rem)] leading-[0.95] tracking-[-0.02em] text-ink">
          {value}
        </div>
        {delta != null && (
          <div className={`mt-2 font-data tnum text-fine ${up ? 'text-up' : 'text-down'}`}>
            {pct(delta)} today
          </div>
        )}
      </div>

      {/* Statement meta: hairline-ruled columns, aligned like a printed ledger */}
      <div className="mt-6 pt-4 border-t border-hairline grid grid-cols-3 divide-x divide-hairline">
        {meta.map((cell, i) => (
          <div key={cell.label} className={i === 0 ? 'pr-4' : 'px-4 last:pr-0'}>
            <div className="text-micro uppercase tracking-[0.14em] text-ink-faint">
              {cell.label}
            </div>
            <div
              className={`mt-1.5 font-data tnum text-fine ${
                cell.tone === 'up' ? 'text-up' : cell.tone === 'down' ? 'text-down' : 'text-ink'
              }`}
            >
              {cell.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
