import { useEffect, useState } from 'react'
import { TelegramTool } from './components/tools/TelegramTool'

interface Signal { label: string; value: string; sub?: string; tone?: 'up' | 'down' }
interface Sentiment {
  ok: boolean
  state: 'HOT' | 'COOLING' | 'COLD' | 'UNKNOWN'
  verdict: string
  score: number | null
  signals: Signal[]
  asOf: string
  degraded: boolean
}

const STATE_COLOR: Record<Sentiment['state'], string> = {
  HOT: 'text-up',
  COOLING: 'text-ink',
  COLD: 'text-down',
  UNKNOWN: 'text-ink-faint',
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export default function App() {
  const [tool, setTool] = useState<string | null>(null)
  const [data, setData] = useState<Sentiment | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/sentiment')
      .then((r) => r.json())
      .then((d: Sentiment) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (tool === 'telegram') return <TelegramTool onBack={() => setTool(null)} />

  return (
    <div className="min-h-screen mx-auto max-w-[430px] flex flex-col overflow-x-hidden px-6">
      <header className="pt-7 flex items-baseline justify-between">
        <span className="font-display text-base text-ink flex items-center gap-1.5">
          Poise
          <span className="w-1.5 h-1.5 rounded-full bg-cobalt translate-y-[-2px]" />
        </span>
        {data && (
          <span className="font-data tnum text-micro uppercase tracking-[0.14em] text-ink-faint">
            {fmtTime(data.asOf)}
          </span>
        )}
      </header>

      {/* THE SIGNAL — the whole product. First thing you see, no chrome. */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col justify-center py-10">
          {loading ? (
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-ink-faint animate-pulse" />
              <span className="text-base text-ink-soft">Reading the market…</span>
            </div>
          ) : data ? (
            <>
              <span className="text-micro uppercase tracking-[0.18em] text-ink-faint">
                Market · right now
              </span>
              <h1
                className={`mt-3 font-display font-semibold text-[clamp(3.25rem,17vw,4.75rem)] leading-[0.92] tracking-[-0.02em] ${STATE_COLOR[data.state]}`}
              >
                {data.state === 'UNKNOWN' ? '—' : data.state}
              </h1>
              <p className="mt-4 text-sub text-ink leading-snug max-w-[19rem]">
                {data.verdict}
              </p>

              {data.signals.length > 0 && (
                <div className="mt-9 pt-5 border-t border-hairline grid grid-cols-3 divide-x divide-hairline">
                  {data.signals.map((s, i) => (
                    <div key={s.label} className={i === 0 ? 'pr-3' : 'px-3 last:pr-0'}>
                      <div className="text-micro uppercase tracking-[0.12em] text-ink-faint leading-tight">
                        {s.label}
                      </div>
                      <div
                        className={`mt-2 font-data tnum text-base ${
                          s.tone === 'up' ? 'text-up' : s.tone === 'down' ? 'text-down' : 'text-ink'
                        }`}
                      >
                        {s.value}
                      </div>
                      {s.sub && <div className="mt-0.5 text-micro text-ink-faint">{s.sub}</div>}
                    </div>
                  ))}
                </div>
              )}
              {data.degraded && data.ok && (
                <p className="mt-4 text-micro text-ink-faint">Partial read — one source is briefly unavailable.</p>
              )}
            </>
          ) : (
            <div className="text-base text-ink-soft">Couldn’t reach the market read. Pull to retry.</div>
          )}
        </div>

        {/* The action you take once you've read the room. Secondary to the signal. */}
        <div className="pb-8">
          <button
            onClick={() => setTool('telegram')}
            className="w-full rounded-xl bg-ink text-paper font-medium text-base py-[18px] active:opacity-90 transition-opacity"
          >
            Create a Telegram group
          </button>
        </div>
      </main>
    </div>
  )
}
