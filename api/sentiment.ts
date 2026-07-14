/** GET /api/sentiment — a live "should I launch right now?" market read.
 *
 *  Composites two keyless sources into one HOT / COOLING / COLD verdict:
 *   - Fear & Greed index (alternative.me) — overall crypto mood.
 *   - SOL 24h momentum + volume (CoinGecko) — the chain memecoins launch on.
 *
 *  Degrades gracefully: if one source is down we read from the other; if both
 *  fail we return state "UNKNOWN" rather than a fake number. Cached in-process. */
import type { VercelRequest, VercelResponse } from '@vercel/node'

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

let cache: { at: number; data: Sentiment } | null = null
const TTL_MS = 5 * 60 * 1000

function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(0) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K'
  return String(Math.round(n))
}

async function fetchFearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Array<{ value?: string; value_classification?: string }> }
    const row = json.data?.[0]
    if (!row?.value) return null
    return { value: Number(row.value), label: row.value_classification ?? '' }
  } catch { return null }
}

async function fetchSol(): Promise<{ change24h: number; volume: number } | null> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana',
      { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as Array<{ price_change_percentage_24h?: number; total_volume?: number }>
    const row = json[0]
    if (!row) return null
    return { change24h: row.price_change_percentage_24h ?? 0, volume: row.total_volume ?? 0 }
  } catch { return null }
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)) }

function compose(fng: Awaited<ReturnType<typeof fetchFearGreed>>, sol: Awaited<ReturnType<typeof fetchSol>>): Sentiment {
  const asOf = new Date().toISOString()
  const signals: Signal[] = []

  // Score components (0..1), reweighted over whatever we actually have.
  const parts: number[] = []
  if (fng) {
    parts.push(clamp01(fng.value / 100))
    signals.push({ label: 'Fear & Greed', value: String(fng.value), sub: fng.label })
  }
  if (sol) {
    parts.push(clamp01((sol.change24h + 10) / 20)) // -10%..+10% -> 0..1
    signals.push({
      label: 'SOL · 24h',
      value: `${sol.change24h >= 0 ? '+' : ''}${sol.change24h.toFixed(1)}%`,
      tone: sol.change24h >= 0 ? 'up' : 'down',
    })
    signals.push({ label: 'SOL volume', value: '$' + compact(sol.volume) })
  }

  if (!parts.length) {
    return { ok: false, state: 'UNKNOWN', verdict: 'Market read unavailable right now.', score: null, signals: [], asOf, degraded: true }
  }

  const score = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100)
  let state: Sentiment['state']
  let verdict: string
  if (score >= 62) { state = 'HOT'; verdict = 'Good window to launch.' }
  else if (score >= 42) { state = 'COOLING'; verdict = 'Mixed — consider waiting for a cleaner window.' }
  else { state = 'COLD'; verdict = 'Cold market. Better to wait.' }

  return { ok: true, state, verdict, score, signals, asOf, degraded: !(fng && sol) }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (cache && Date.now() - cache.at < TTL_MS) {
    res.setHeader('cache-control', 's-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(cache.data)
  }
  const [fng, sol] = await Promise.all([fetchFearGreed(), fetchSol()])
  const data = compose(fng, sol)
  if (data.ok) cache = { at: Date.now(), data }
  res.setHeader('cache-control', 's-maxage=300, stale-while-revalidate=600')
  return res.status(200).json(data)
}
