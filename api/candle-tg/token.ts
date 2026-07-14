/** GET /api/candle-tg/token?ca=<address> — resolve token name/ticker/logo.
 *  Powers the UI's live ticker preview + linkName auto-suggest. */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchTokenMeta } from './_token.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const ca = typeof req.query.ca === 'string' ? req.query.ca : ''
  if (!ca) return res.status(400).json({ error: 'CA is required' })

  const token = await fetchTokenMeta(ca)
  if (!token) return res.status(404).json({ error: 'Token not found' })

  return res.status(200).json(token)
}
