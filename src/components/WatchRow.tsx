import { compact, pct, usd } from '../lib/format'
import type { Token } from '../lib/types'

/** One watchlist entry. Symbol in the serif for character; all figures tabular
 *  mono, right-aligned so a column of prices reads like a statement. Full-width
 *  tap target sized for a thumb. */
export function WatchRow({ token }: { token: Token }) {
  const up = token.change5m >= 0
  return (
    <button className="w-full flex items-center gap-4 py-4 text-left active:bg-paper/60 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="font-display text-base text-ink truncate">{token.symbol}</div>
        <div className="mt-0.5 font-data tnum text-fine text-ink-soft">{usd(token.price)}</div>
      </div>
      <div className="text-right">
        <div className={`font-data tnum text-base ${up ? 'text-up' : 'text-down'}`}>
          {pct(token.change5m)}
        </div>
        <div className="mt-0.5 font-data tnum text-micro text-ink-faint uppercase tracking-wider">
          {compact(token.mcap)} mc
        </div>
      </div>
    </button>
  )
}
