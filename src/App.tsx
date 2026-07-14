import { useEffect, useState } from 'react'
import { Panel } from './components/Panel'
import { Stat } from './components/Stat'
import { TokenRow } from './components/TokenRow'
import { apiGet } from './lib/api'
import type { Token } from './lib/types'

/** Placeholder feed until the real data source is wired.
 *  Replace with `apiGet<Token[]>('tokens')` once the endpoint exists. */
const SAMPLE: Token[] = [
  { address: '1', symbol: 'WOLF', price: 0.0000108, mcap: 10768, volume5m: 42000, change5m: 128.4 },
  { address: '2', symbol: 'BARTS', price: 0.0000257, mcap: 25684, volume5m: 11700, change5m: 34.1 },
  { address: '3', symbol: 'GHOST', price: 0.0000057, mcap: 5754, volume5m: 8300, change5m: -12.7 },
  { address: '4', symbol: 'PULSE', price: 0.00034, mcap: 340000, volume5m: 96000, change5m: 52.0 },
  { address: '5', symbol: 'RUGZ', price: 0.0011, mcap: 120000, volume5m: 4200, change5m: -41.0 },
]

export default function App() {
  const [health, setHealth] = useState<'…' | 'up' | 'down'>('…')

  useEffect(() => {
    // Confirms the serverless API + DB wiring end-to-end; harmless if absent.
    apiGet<{ db: string }>('health')
      .then((h) => setHealth(h.db === 'up' ? 'up' : 'down'))
      .catch(() => setHealth('down'))
  }, [])

  return (
    <div className="min-h-screen mx-auto max-w-[430px] flex flex-col">
      {/* Terminal header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-base/90 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-lime rounded-full" />
          <h1 className="font-mono text-sm tracking-[0.2em] uppercase text-ink">
            edge<span className="text-lime">/</span>terminal
          </h1>
        </div>
        <span
          className="text-[10px] font-mono uppercase tracking-wider text-ink-faint"
          title="serverless API + DB status"
        >
          api{' '}
          <span className={health === 'up' ? 'text-lime' : health === 'down' ? 'text-down' : 'text-ink-faint'}>
            ●
          </span>
        </span>
      </header>

      <main className="flex-1 flex flex-col gap-3 p-3">
        {/* Portfolio strip */}
        <Panel label="portfolio · paper">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="equity" value="$1,240" delta={12.4} />
            <Stat label="24h pnl" value="+$138" delta={11.1} />
            <Stat label="win rate" value="45%" />
          </div>
        </Panel>

        {/* Live feed */}
        <Panel
          label="live feed · solana"
          right={
            <span className="text-[10px] font-mono text-lime uppercase tracking-wider">
              {SAMPLE.length} live
            </span>
          }
          className="overflow-hidden"
        >
          <div className="-mx-3 -my-3">
            {SAMPLE.map((t) => (
              <TokenRow key={t.address} token={t} />
            ))}
          </div>
        </Panel>

        <p className="text-center text-[10px] font-mono text-ink-faint tracking-wider uppercase pt-2">
          scaffold ready · wire real data in src/lib + /api
        </p>
      </main>

      {/* Bottom nav — thumb-reachable, the way a phone tool should be */}
      <nav className="sticky bottom-0 grid grid-cols-4 border-t border-line bg-base/95 backdrop-blur">
        {['feed', 'scan', 'trades', 'more'].map((tab, i) => (
          <button
            key={tab}
            className={`py-3 text-[11px] font-mono uppercase tracking-wider transition-colors ${
              i === 0 ? 'text-lime' : 'text-ink-faint active:text-ink'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>
    </div>
  )
}
