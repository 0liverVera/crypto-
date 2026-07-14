import { useCallback, useRef, useState } from 'react'

/** Copy-to-clipboard hook: returns [copied, copy]; resets after `ms`. */
export function useCopied(ms = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), ms)
    }).catch(() => {})
  }, [ms])

  return [copied, copy]
}
