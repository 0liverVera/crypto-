import { Statement } from './components/Statement'
import { WatchRow } from './components/WatchRow'
import { Label } from './components/Label'
import type { Token } from './lib/types'

/** Sample watchlist until a live source is wired. */
const WATCH: Token[] = [
  { address: '1', symbol: 'Solana', price: 178.42, mcap: 84_000_000_000, volume5m: 0, change5m: 2.1 },
  { address: '2', symbol: 'Jupiter', price: 0.94, mcap: 1_300_000_000, volume5m: 0, change5m: 5.4 },
  { address: '3', symbol: 'Jito', price: 3.12, mcap: 420_000_000, volume5m: 0, change5m: -1.8 },
  { address: '4', symbol: 'Pyth', price: 0.41, mcap: 380_000_000, volume5m: 0, change5m: -0.6 },
  { address: '5', symbol: 'Drift', price: 0.88, mcap: 190_000_000, volume5m: 0, change5m: 3.3 },
]

const NAV = ['Home', 'Watch', 'You'] as const

export default function App() {
  return (
    <div className="min-h-screen mx-auto max-w-[430px] flex flex-col overflow-x-hidden">
      {/* Wordmark + statement date — quiet, editorial */}
      <header className="flex items-baseline justify-between px-6 pt-7 pb-5">
        <h1 className="font-display text-sub text-ink tracking-[-0.01em] flex items-center gap-1.5">
          Poise
          <span className="w-1.5 h-1.5 rounded-full bg-cobalt translate-y-[-2px]" />
        </h1>
        <span className="font-data tnum text-micro uppercase tracking-[0.14em] text-ink-faint">
          13 Jul
        </span>
      </header>

      <main className="flex-1 flex flex-col gap-8 px-6 pb-6">
        {/* THE STATEMENT — signature hero */}
        <Statement
          label="Portfolio — paper"
          value="$12,480.32"
          delta={2.4}
          meta={[
            { label: 'Day', value: '+$291.40', tone: 'up' },
            { label: 'Positions', value: '6' },
            { label: 'Open', value: '+18.2%', tone: 'up' },
          ]}
        />

        {/* Watchlist */}
        <section>
          <Label right={
            <span className="font-data tnum text-micro text-ink-faint uppercase tracking-wider">
              {WATCH.length}
            </span>
          }>
            Watchlist
          </Label>
          <div className="mt-1 divide-y divide-hairline">
            {WATCH.map((t) => (
              <WatchRow key={t.address} token={t} />
            ))}
          </div>
        </section>

        {/* Primary action — one ink button, thumb-reachable */}
        <button className="w-full rounded-lg bg-ink text-paper font-medium text-base py-4 active:opacity-90 transition-opacity">
          Track a token
        </button>
      </main>

      {/* Minimal nav — three destinations, cobalt marks the active one */}
      <nav className="sticky bottom-0 bg-paper/90 backdrop-blur border-t border-hairline grid grid-cols-3">
        {NAV.map((item, i) => {
          const active = i === 0
          return (
            <button
              key={item}
              className="py-3.5 flex flex-col items-center gap-1.5 text-fine"
            >
              <span className={active ? 'text-ink font-medium' : 'text-ink-faint'}>{item}</span>
              <span
                className={`w-1 h-1 rounded-full ${active ? 'bg-cobalt' : 'bg-transparent'}`}
              />
            </button>
          )
        })}
      </nav>
    </div>
  )
}
