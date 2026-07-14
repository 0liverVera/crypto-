/** Shared Postgres access for serverless functions (Neon/Supabase).
 *
 * Uses the Neon serverless driver, which speaks Postgres over HTTP/WebSocket
 * so it works from Vercel's edge/serverless runtime without a pooled TCP
 * connection. Works against any Postgres that exposes a connection string;
 * Neon's free tier is the zero-config default.
 *
 * Set DATABASE_URL in the environment (see .env.example). */
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  // Fail loudly at cold start rather than silently returning empty results.
  console.warn('[db] DATABASE_URL is not set — API routes that hit the DB will 500')
}

/** Tagged-template SQL client: sql`select * from t where id = ${id}` */
export const sql = neon(url ?? '')

export function requireDb(): void {
  if (!url) throw new Error('DATABASE_URL is not configured')
}
