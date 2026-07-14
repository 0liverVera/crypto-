/** Shared Postgres access for serverless functions (Neon/Supabase).
 *
 * Uses the Neon serverless driver, which speaks Postgres over HTTP so it works
 * from Vercel's serverless runtime without a pooled TCP connection. Works
 * against any Postgres exposing a connection string; Neon's free tier is the
 * zero-config default.
 *
 * The client is created lazily: `neon()` throws when given an empty connection
 * string, so constructing it at module load would crash every function before
 * its handler could respond. Building it on first use lets handlers catch the
 * missing-config case and return a clean error instead.
 *
 * Set DATABASE_URL in the environment (see .env.example). */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

let _sql: NeonQueryFunction<false, false> | null = null

/** Returns the SQL tagged-template client, or throws if DATABASE_URL is unset. */
export function getSql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
  _sql = neon(url)
  return _sql
}

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL)
}
