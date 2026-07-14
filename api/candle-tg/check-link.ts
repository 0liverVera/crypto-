/** GET /api/candle-tg/check-link?name=<name>&ca=<address>
 *
 *  Live availability + anti-squat check for the verify channel's public
 *  t.me/<name> username. Resolves the name on Telegram via MTProto and applies
 *  the ticker-substring rule (same validator as /build — single source of truth).
 *
 *  Ported from the Next.js route: Discord-auth gate removed (standalone app),
 *  per-user rate limit re-keyed to client IP. */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { fetchTokenMeta } from './_token.js'
import { validateLinkName } from '../../src/lib/candle-tg/linkName.js'

// MTProto resolve calls are expensive — each check spins up a GramJS session.
// Cap at 30/min per client IP. In-memory, per warm instance (best-effort).
const checkLog = new Map<string, number[]>()
const MAX_PER_MIN = 30
const MINUTE_MS = 60_000

function clientKey(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  const ip = Array.isArray(fwd) ? fwd[0] : (fwd ?? '').split(',')[0].trim()
  return ip || 'unknown'
}

function withinRateLimit(key: string): boolean {
  const now = Date.now()
  const recent = (checkLog.get(key) ?? []).filter((t) => now - t < MINUTE_MS)
  if (recent.length >= MAX_PER_MIN) return false
  recent.push(now)
  checkLog.set(key, recent)
  return true
}

export type CheckLinkResponse =
  | { status: 'available' }
  | { status: 'taken' }
  | { status: 'reserved' }
  | { status: 'invalid'; reason: string }
  | { status: 'off-ticker'; expected: string; ticker: string }
  | { status: 'ticker-incompatible'; ticker: string }
  | { status: 'error'; reason: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', reason: 'Method not allowed' })
  }

  if (!withinRateLimit(clientKey(req))) {
    return res.status(429).json({ status: 'error', reason: 'Too many checks — slow down.' })
  }

  const name = typeof req.query.name === 'string' ? req.query.name : ''
  const ca = typeof req.query.ca === 'string' ? req.query.ca : ''
  if (!name || !ca) {
    return res.status(400).json({ status: 'error', reason: 'Both `name` and `ca` query params required.' })
  }

  if (!process.env.TG_SESSION || !process.env.TG_API_ID || !process.env.TG_API_HASH) {
    return res.status(503).json({ status: 'error', reason: 'CandleTG not configured on this deployment.' })
  }

  // Step 1: resolve token metadata to know the ticker for substring binding.
  const token = await fetchTokenMeta(ca)
  if (!token) {
    return res.status(404).json({ status: 'error', reason: 'Token metadata unavailable for this CA.' })
  }

  // Step 2: format + ticker-substring validation (same helper as /build).
  // Returns HTTP 200 with `status` in the body for validation outcomes — this
  // endpoint is a "is this OK to submit?" probe, so the outcome IS the answer.
  const result = validateLinkName(name.trim().replace(/^@/, ''), token.ticker)
  if (!result.ok) {
    switch (result.kind) {
      case 'invalid-format':
        return res.status(200).json({ status: 'invalid', reason: '5-32 chars: letters, digits, underscores, starts with a letter.' })
      case 'off-ticker':
        return res.status(200).json({ status: 'off-ticker', expected: result.expected, ticker: token.ticker })
      case 'ticker-incompatible':
        return res.status(200).json({ status: 'ticker-incompatible', ticker: token.ticker })
    }
  }

  // Step 3: check Telegram for availability via MTProto.
  let client: TelegramClient | null = null
  try {
    client = new TelegramClient(
      new StringSession(process.env.TG_SESSION ?? ''),
      parseInt(process.env.TG_API_ID ?? '0'),
      process.env.TG_API_HASH ?? '',
      { connectionRetries: 2 },
    )
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('TG connect timeout')), 10_000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }

    try {
      await client.invoke(new Api.contacts.ResolveUsername({ username: (result as { linkName: string }).linkName }))
      // Resolved successfully → already exists on Telegram → taken.
      return res.status(200).json({ status: 'taken' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // USERNAME_NOT_OCCUPIED — free to claim. USERNAME_INVALID — passes our
      // regex but Telegram reserves it (banned word, `telegram*`, etc.).
      if (/USERNAME_NOT_OCCUPIED/i.test(msg)) {
        return res.status(200).json({ status: 'available' })
      }
      if (/USERNAME_INVALID/i.test(msg)) {
        return res.status(200).json({ status: 'reserved' })
      }
      console.error('[candle-tg] check-link resolve error:', msg)
      return res.status(502).json({ status: 'error', reason: 'Could not check availability.' })
    }
  } catch (e: unknown) {
    console.error('[candle-tg] check-link client error:', e)
    return res.status(502).json({ status: 'error', reason: 'Could not reach Telegram.' })
  } finally {
    if (client) await client.disconnect().catch(() => {})
  }
}
