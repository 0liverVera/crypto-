import { useState } from 'react'
import { Lifecycle, type Step } from './components/Lifecycle'

/** The launch lifecycle. Tools sit at their step; empty steps are quiet
 *  "coming" states so the whole thing reads as one system with a roadmap. */
const STEPS: Step[] = [
  {
    n: '01',
    phase: 'Time it',
    title: 'Market Sentiment',
    desc: 'Read live market conditions and know whether now is the moment to launch — or whether to wait.',
    status: 'live',
    key: 'sentiment',
  },
  {
    n: '02',
    phase: 'Launch it',
    title: 'Token deployer',
    desc: '',
    status: 'soon',
  },
  {
    n: '03',
    phase: 'Build the community',
    title: 'Telegram Group Creator',
    desc: 'Paste a contract address — get a captcha-gated community group in seconds, and an invite to it.',
    status: 'live',
    key: 'telegram',
  },
  {
    n: '04',
    phase: 'Grow it',
    title: 'Growth tools',
    desc: '',
    status: 'soon',
  },
]

const TOOL_TITLES: Record<string, string> = {
  sentiment: 'Market Sentiment',
  telegram: 'Telegram Group Creator',
}

export default function App() {
  const [openTool, setOpenTool] = useState<string | null>(null)

  if (openTool) {
    return <ToolScreen title={TOOL_TITLES[openTool] ?? 'Tool'} onBack={() => setOpenTool(null)} />
  }

  return (
    <div className="min-h-screen mx-auto max-w-[430px] flex flex-col overflow-x-hidden">
      <header className="px-6 pt-7 pb-6">
        <h1 className="font-display text-sub text-ink tracking-[-0.01em] flex items-center gap-1.5">
          Poise
          <span className="w-1.5 h-1.5 rounded-full bg-cobalt translate-y-[-2px]" />
        </h1>
      </header>

      <main className="flex-1 flex flex-col px-6 pb-10">
        {/* What this is — plain language, no fluff */}
        <div className="mb-9">
          <h2 className="font-display text-title text-ink leading-[1.15] tracking-[-0.015em]">
            Everything it takes to launch a memecoin.
          </h2>
          <p className="mt-3 text-base text-ink-soft leading-relaxed">
            The slow, manual parts of a launch — automated. Start at any step.
          </p>
        </div>

        <Lifecycle steps={STEPS} onOpen={setOpenTool} />
      </main>
    </div>
  )
}

/** Minimal on-brand tool screen. Real tool UIs land here next. */
function ToolScreen({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="min-h-screen mx-auto max-w-[430px] flex flex-col overflow-x-hidden px-6">
      <header className="pt-7 pb-6">
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
      <div className="flex-1 flex flex-col pt-6">
        <span className="text-micro uppercase tracking-[0.16em] text-ink-faint">Tool</span>
        <h1 className="mt-2 font-display text-title text-ink tracking-[-0.015em]">{title}</h1>
        <p className="mt-3 text-base text-ink-soft leading-relaxed">
          This tool is being wired up — it opens here next.
        </p>
      </div>
    </div>
  )
}
