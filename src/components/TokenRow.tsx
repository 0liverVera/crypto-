import { compact, pct, usd } from '../lib/format'
import type { Token } from '../lib/types'

/** One dense token row: symbol, price, mcap, momentum. Tap target is full-width. */
export function TokenRow({ token }: { token: Token }) {
  const up = token.change5m >= 0
  return (
    <button className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0 active:bg-panel-2 transition-colors text-left">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink truncate">${token.symbol}</span>
          <span className="text-[10px] font-mono text-ink-faint tnum">
            {compact(token.mcap)} mc
          </span>
        </div>
        <div className="text-[11px] text-ink-mute tnum">{usd(token.price)}</div>
      </div>
      <div className="text-right">
        <div className={`text-sm tnum ${up ? 'text-up' : 'text-down'}`}>
          {pct(token.change5m)}
        </div>
        <div className="text-[10px] font-mono text-ink-faint tnum">
          {compact(token.volume5m)} vol
        </div>
      </div>
    </button>
  )
}
