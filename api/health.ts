/** GET /api/health — liveness + DB connectivity check.
 *
 * Returns { ok, db, time } so you can confirm the serverless function runs
 * and that DATABASE_URL actually reaches Postgres. Never throws: a missing or
 * broken DB is reported as db:"down", not a 500. */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql, hasDb } from './_db.js'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  let db: 'up' | 'down' = 'down'
  let dbError: string | undefined

  if (!hasDb()) {
    dbError = 'DATABASE_URL not set'
  } else {
    try {
      const rows = (await getSql()`select 1 as ok`) as Array<{ ok: number }>
      db = rows[0]?.ok === 1 ? 'up' : 'down'
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err)
    }
  }

  res.status(db === 'up' ? 200 : 503).json({
    ok: db === 'up',
    db,
    ...(dbError ? { dbError } : {}),
    time: new Date().toISOString(),
  })
}
