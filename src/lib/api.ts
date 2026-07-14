/** Thin client for our serverless API routes under /api.
 *
 * In dev, Vite proxies /api to the functions runtime (see vite.config.ts).
 * On Vercel, /api/* are serverless functions in the repo's /api directory. */

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path.replace(/^\//, '')}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body || res.statusText)
  }
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
