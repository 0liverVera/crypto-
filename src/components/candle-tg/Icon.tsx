import type { CSSProperties } from 'react'

/** Minimal inline-SVG icon set for the CandleTG tool (check / copy). */
export function Icon({
  name,
  size = 12,
  style,
}: {
  name: 'check' | 'copy'
  size?: number
  style?: CSSProperties
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  }
  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="M20 6L9 17l-5-5" />
      </svg>
    )
  }
  return (
    <svg {...common} strokeWidth={2}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}
