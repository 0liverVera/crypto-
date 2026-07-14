import { useEffect, useRef, useState } from 'react'
import { sanitiseTicker } from '../../lib/candle-tg/linkName'

/** Telegram Group Creator — paste a contract, get a captcha-gated community.
 *  Wired to /api/candle-tg/*: live token resolution, branded-link availability,
 *  and the build call. Poise aesthetic, not the original terminal look. */

interface TokenMeta { name: string; ticker: string; logo: string | null }

type LinkStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken' }
  | { state: 'reserved' }
  | { state: 'invalid'; reason: string }
  | { state: 'off-ticker'; expected: string }
  | { state: 'ticker-incompatible' }
  | { state: 'error'; reason: string }

interface BuildResult {
  inviteLink: string
  groupInviteLink?: string
  token?: { name: string; ticker: string }
  linkName?: string
  linkNameClaimed?: boolean
}

const inputCls =
  'w-full bg-surface border border-hairline rounded-lg px-4 py-3.5 text-base text-ink ' +
  'placeholder:text-ink-faint outline-none focus:border-hairline-2 transition-colors'

function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <span className="text-micro uppercase tracking-[0.16em] text-ink-faint font-medium">
        {children}
      </span>
      {hint && <span className="text-micro text-ink-faint">{hint}</span>}
    </div>
  )
}

export function TelegramTool({ onBack }: { onBack: () => void }) {
  const [ca, setCa] = useState('')
  const [username, setUsername] = useState('')
  const [linkName, setLinkName] = useState('')
  const [linkTouched, setLinkTouched] = useState(false)
  const [token, setToken] = useState<TokenMeta | null>(null)
  const [linkStatus, setLinkStatus] = useState<LinkStatus>({ state: 'idle' })
  const [phase, setPhase] = useState<'form' | 'building' | 'done'>('form')
  const [result, setResult] = useState<BuildResult | null>(null)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [copied, setCopied] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Is CandleTG configured on this deployment? (probe never spends a build slot)
  useEffect(() => {
    fetch('/api/candle-tg/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _probe: true }),
    })
      .then((r) => setConfigured(r.status !== 503))
      .catch(() => setConfigured(false))
    return () => abortRef.current?.abort()
  }, [])

  // Debounced token resolution → drives the ticker preview + link auto-suggest
  useEffect(() => {
    const trimmed = ca.trim()
    if (!trimmed) { setToken(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/candle-tg/token?ca=${encodeURIComponent(trimmed)}`)
        if (!res.ok) { if (!cancelled) setToken(null); return }
        const data = (await res.json()) as TokenMeta
        if (cancelled) return
        setToken(data)
        if (!linkTouched && data.ticker) {
          const s = sanitiseTicker(data.ticker)
          if (s) setLinkName(`${s}_verify`)
        }
      } catch { if (!cancelled) setToken(null) }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ca])

  // Debounced branded-link availability check
  useEffect(() => {
    const name = linkName.trim()
    if (!name || !ca.trim()) { setLinkStatus({ state: 'idle' }); return }
    setLinkStatus({ state: 'checking' })
    let cancelled = false
    const controller = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/candle-tg/check-link?name=${encodeURIComponent(name)}&ca=${encodeURIComponent(ca.trim())}`,
          { signal: controller.signal },
        )
        const data = await res.json()
        if (cancelled) return
        setLinkStatus(
          data.status === 'off-ticker'
            ? { state: 'off-ticker', expected: data.expected }
            : data.status === 'invalid'
              ? { state: 'invalid', reason: data.reason }
              : data.status === 'error'
                ? { state: 'error', reason: data.reason }
                : { state: data.status },
        )
      } catch { if (!cancelled) setLinkStatus({ state: 'error', reason: 'Could not check.' }) }
    }, 650)
    return () => { cancelled = true; clearTimeout(t); controller.abort() }
  }, [linkName, ca])

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(''), 1500)
    } catch { /* clipboard unavailable */ }
  }

  const linkBlocking = linkName.trim().length > 0 && linkStatus.state !== 'available'
  const canBuild =
    configured !== false && ca.trim().length > 0 && username.trim().length > 0 && !linkBlocking

  async function handleBuild() {
    if (!canBuild) return
    setPhase('building'); setError('')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/candle-tg/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ca: ca.trim(),
          chain: 'Solana',
          username: username.trim(),
          linkName: linkName.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (data.inviteLink) { setResult(data as BuildResult); setPhase('done') }
      else { setError(data.error ?? 'Something went wrong. Please try again.'); setPhase('form') }
    } catch {
      setError('The build didn’t complete — it can exceed this hosting tier’s 60s limit. Try again, or run it on a longer-timeout host.')
      setPhase('form')
    }
  }

  function reset() {
    setPhase('form'); setResult(null); setError('')
    setCa(''); setUsername(''); setLinkName(''); setLinkTouched(false)
    setToken(null); setLinkStatus({ state: 'idle' })
  }

  return (
    <div className="min-h-screen mx-auto max-w-[430px] flex flex-col overflow-x-hidden px-6">
      <header className="pt-7 pb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-fine text-ink-soft active:text-ink transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H6M12 5l-7 7 7 7" />
          </svg>
          Back
        </button>
      </header>

      <div className="pb-3">
        <span className="text-micro uppercase tracking-[0.16em] text-ink-faint">03 · Build the community</span>
        <h1 className="mt-1.5 font-display text-title text-ink tracking-[-0.015em]">
          Telegram Group Creator
        </h1>
        <p className="mt-2 text-base text-ink-soft leading-relaxed">
          Paste a contract address. Get a captcha-gated community group in seconds — and an invite to it.
        </p>
      </div>

      {configured === false && (
        <div className="mt-3 rounded-lg border border-hairline bg-surface px-4 py-3 text-fine text-ink-soft leading-relaxed">
          This tool isn’t configured on this deployment yet — the Telegram builder
          credentials aren’t set. The form works; the build will report it’s unconfigured.
        </div>
      )}

      {phase === 'building' && <BuildingState />}

      {phase === 'done' && result && (
        <DoneState result={result} copied={copied} onCopy={copy} onReset={reset} />
      )}

      {phase === 'form' && (
        <main className="flex-1 flex flex-col gap-6 pt-6 pb-10">
          {/* Contract address */}
          <div>
            <FieldLabel>Contract address</FieldLabel>
            <input
              className={`${inputCls} font-data text-fine`}
              placeholder="Solana token address"
              value={ca}
              onChange={(e) => setCa(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {token && (
              <div className="mt-2 flex items-center gap-2.5">
                {token.logo && (
                  <img
                    src={token.logo}
                    alt=""
                    className="w-5 h-5 rounded-full object-cover"
                    onError={(e) => { (e.currentTarget.style.display = 'none') }}
                  />
                )}
                <span className="text-fine text-ink">
                  {token.name} <span className="text-ink-faint">·</span>{' '}
                  <span className="font-data tnum text-cobalt">${token.ticker}</span>
                </span>
              </div>
            )}
          </div>

          {/* Your Telegram username */}
          <div>
            <FieldLabel>Your Telegram username</FieldLabel>
            <input
              className={inputCls}
              placeholder="@yourname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="mt-2 text-micro text-ink-faint">You’ll be added as the group’s founder.</p>
          </div>

          {/* Branded verify link (optional) */}
          <div>
            <FieldLabel hint="optional">Verify link name</FieldLabel>
            <input
              className={inputCls}
              placeholder={token ? `${sanitiseTicker(token.ticker)}_verify` : 'pepe_verify'}
              value={linkName}
              onChange={(e) => { setLinkName(e.target.value.trim().replace(/^@/, '')); setLinkTouched(true) }}
              spellCheck={false}
              autoComplete="off"
            />
            <LinkHint status={linkStatus} name={linkName} />
          </div>

          {error && (
            <div className="rounded-lg border border-down/30 bg-down/[0.04] px-4 py-3 text-fine text-down leading-relaxed">
              {error}
            </div>
          )}

          <button
            onClick={handleBuild}
            disabled={!canBuild}
            className="w-full rounded-lg bg-ink text-paper font-medium text-base py-4 active:opacity-90 transition-opacity disabled:opacity-30"
          >
            Create the group
          </button>
        </main>
      )}
    </div>
  )
}

function LinkHint({ status, name }: { status: LinkStatus; name: string }) {
  const tag = name.trim() || 'name'
  switch (status.state) {
    case 'idle':
      return <p className="mt-2 text-micro text-ink-faint">Must contain the token’s ticker. Leave blank for a plain invite link.</p>
    case 'checking':
      return <p className="mt-2 text-micro text-ink-faint">Checking t.me/{tag}…</p>
    case 'available':
      return <p className="mt-2 text-micro text-up">t.me/{tag} is available.</p>
    case 'taken':
      return <p className="mt-2 text-micro text-down">t.me/{tag} is already taken.</p>
    case 'reserved':
      return <p className="mt-2 text-micro text-down">t.me/{tag} is reserved by Telegram. Pick another.</p>
    case 'off-ticker':
      return <p className="mt-2 text-micro text-down">Must contain the ticker. Try {status.expected}.</p>
    case 'ticker-incompatible':
      return <p className="mt-2 text-micro text-down">This ticker can’t form a public link — leave blank.</p>
    case 'invalid':
      return <p className="mt-2 text-micro text-down">{status.reason}</p>
    case 'error':
      return <p className="mt-2 text-micro text-down">{status.reason}</p>
  }
}

function BuildingState() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-4 py-24 text-center">
      <span className="w-2.5 h-2.5 rounded-full bg-cobalt animate-pulse" />
      <div>
        <p className="font-display text-sub text-ink">Building your community</p>
        <p className="mt-1.5 text-fine text-ink-soft">
          Creating the group, adding the captcha gate, and inviting you in. This can take up to a minute.
        </p>
      </div>
    </main>
  )
}

function DoneState({
  result,
  copied,
  onCopy,
  onReset,
}: {
  result: BuildResult
  copied: string
  onCopy: (t: string) => void
  onReset: () => void
}) {
  return (
    <main className="flex-1 flex flex-col gap-6 pt-6 pb-10">
      <div>
        <span className="text-micro uppercase tracking-[0.16em] text-up">Community live</span>
        <h2 className="mt-1.5 font-display text-sub text-ink">
          {result.token ? `${result.token.name} ` : ''}
          {result.token && <span className="font-data text-cobalt">${result.token.ticker}</span>}
        </h2>
      </div>

      <LinkRow label="Verify channel — share this" url={result.inviteLink} copied={copied} onCopy={onCopy} />
      {result.groupInviteLink && (
        <LinkRow label="Group invite — join as founder" url={result.groupInviteLink} copied={copied} onCopy={onCopy} />
      )}

      {result.linkName && result.linkNameClaimed === false && (
        <p className="text-micro text-ink-soft">
          Note: t.me/{result.linkName} was unavailable, so a plain invite link was used instead.
        </p>
      )}

      <button
        onClick={onReset}
        className="w-full rounded-lg border border-hairline bg-surface text-ink font-medium text-base py-4 active:bg-paper/50 transition-colors"
      >
        Build another
      </button>
    </main>
  )
}

function LinkRow({
  label,
  url,
  copied,
  onCopy,
}: {
  label: string
  url: string
  copied: string
  onCopy: (t: string) => void
}) {
  return (
    <div>
      <div className="mb-2 text-micro uppercase tracking-[0.16em] text-ink-faint">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-4 py-3">
        <span className="flex-1 font-data text-fine text-ink truncate">{url}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-fine text-cobalt active:opacity-70"
        >
          Open
        </a>
        <button onClick={() => onCopy(url)} className="shrink-0 text-fine text-ink-soft active:text-ink">
          {copied === url ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
