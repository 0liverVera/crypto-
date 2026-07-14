/** Formatting helpers for dense numeric display in a trading UI. */

export function usd(value: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value)) return '—'
  if (opts.compact) return '$' + compact(value)
  if (Math.abs(value) < 1) {
    // sub-dollar prices: show enough significant digits, trim trailing zeros
    return '$' + value.toPrecision(4).replace(/\.?0+$/, '')
  }
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function compact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K'
  return value.toFixed(0)
}

export function pct(value: number, withSign = true): string {
  if (!Number.isFinite(value)) return '—'
  const sign = withSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

/** Compact relative time, e.g. "3m", "2h", "5d". */
export function ago(iso: string | number | Date): string {
  const then = new Date(iso).getTime()
  const secs = Math.max(0, (Date.now() - then) / 1000)
  if (secs < 60) return `${Math.floor(secs)}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}
