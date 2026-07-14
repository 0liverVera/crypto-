/** GET /api/health — liveness + DB connectivity check.
 *
 * Returns { ok, db, time } so you can confirm the serverless function runs
 * and the DATABASE_URL actually reaches Postgres. */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  let db: 'up' | 'down' = 'down'
  let dbError: string | undefined
  try {
    const rows = (await sql`select 1 as ok`) as Array<{ ok: number }>
    db = rows[0]?.ok === 1 ? 'up' : 'down'
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err)
  }
  res.status(db === 'up' ? 200 : 503).json({
    ok: db === 'up',
    db,
    ...(dbError ? { dbError } : {}),
    time: new Date().toISOString(),
  })
}
