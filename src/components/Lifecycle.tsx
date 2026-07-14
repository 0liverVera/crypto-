/** The signature element: the home screen IS the launch flow.
 *  A vertical spine of lifecycle steps. Live tools are tappable cards; steps
 *  with no tool yet are quiet "coming" rows — so it reads as one coherent
 *  system with a roadmap, not a folder of utilities. */

export interface Step {
  n: string
  phase: string
  title: string
  desc: string
  status: 'live' | 'soon'
  key?: string
}

function Arrow() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h13M12 5l7 7-7 7" />
    </svg>
  )
}

export function Lifecycle({
  steps,
  onOpen,
}: {
  steps: Step[]
  onOpen: (key: string) => void
}) {
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.n} className="relative pl-9 pb-5 last:pb-0">
          {/* connector to the next node — omitted on the last step so the
              spine ends cleanly instead of trailing off */}
          {i < steps.length - 1 && (
            <span className="absolute left-[11px] top-[13px] bottom-[-6px] w-px bg-hairline" aria-hidden />
          )}
          {/* node — cobalt = you can act here; hollow = coming */}
          <span
            className={`absolute left-1 top-[6px] w-3.5 h-3.5 rounded-full ring-4 ring-paper ${
              s.status === 'live' ? 'bg-cobalt' : 'border border-hairline-2 bg-paper'
            }`}
            aria-hidden
          />

          {s.status === 'live' ? (
            <button
              onClick={() => s.key && onOpen(s.key)}
              className="w-full text-left bg-surface border border-hairline rounded-lg p-4 active:border-hairline-2 active:bg-paper/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-micro uppercase tracking-[0.16em] text-ink-faint pt-0.5">
                  {s.n} · {s.phase}
                </div>
                <span className="text-cobalt shrink-0">
                  <Arrow />
                </span>
              </div>
              <h3 className="mt-1 font-display text-sub text-ink tracking-[-0.01em]">
                {s.title}
              </h3>
              <p className="mt-1.5 text-fine text-ink-soft leading-relaxed">{s.desc}</p>
            </button>
          ) : (
            <div className="py-1">
              <div className="flex items-center gap-2.5">
                <span className="text-micro uppercase tracking-[0.16em] text-ink-faint">
                  {s.n} · {s.phase}
                </span>
                <span className="text-micro uppercase tracking-[0.12em] text-ink-faint border border-hairline rounded-full px-2 py-[3px] leading-none">
                  Coming
                </span>
              </div>
              <h3 className="mt-1 font-display text-sub text-ink-faint tracking-[-0.01em]">
                {s.title}
              </h3>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}
