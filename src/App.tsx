import { useState, useCallback } from 'react'
import TelemetryBar from './components/TelemetryBar'
import CreateSLAPanel from './components/CreateSLAPanel'
import SLADeskPanel from './components/SLADeskPanel'
import FAQModal from './components/FAQModal'
import { ArrowUpRight } from 'lucide-react'

const MAINNET_ADDR = '0x675d7feefce17095bab4538b03480227a74d3242'

export default function App() {
  const [refetchKey, setRefetchKey] = useState(0)
  const [faqOpen, setFaqOpen] = useState(false)

  const handleCreated = useCallback(() => {
    setRefetchKey((k) => k + 1)
  }, [])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <TelemetryBar onFaqOpen={() => setFaqOpen(true)} />

      <main className="max-w-[1360px] mx-auto px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">
          <div className="lg:sticky lg:top-[89px]">
            <CreateSLAPanel onCreated={handleCreated} />
          </div>
          <div>
            <SLADeskPanel refetchKey={refetchKey} onResolved={handleCreated} />
          </div>
        </div>

        {/* Footer */}
        <footer
          className="mt-10 pt-4 pb-5 flex flex-wrap items-center justify-between gap-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {/* Left: branding + network */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-4 h-4 rounded-[3px] flex items-center justify-center shrink-0"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}
            >
              <span className="display text-[9px] font-700 leading-none" style={{ color: 'var(--text-primary)' }}>B</span>
            </div>
            <span className="display text-[12px] font-600" style={{ color: 'var(--text-3)' }}>Breach Protocol</span>
            <span style={{ color: 'var(--text-4)' }}>·</span>
            <span className="text-[11px]" style={{ color: 'var(--text-4)' }}>Live on Arc Mainnet</span>
            <span style={{ color: 'var(--text-4)' }}>·</span>
            <a
              href={`https://explorer.arc.io/address/${MAINNET_ADDR}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 transition-opacity hover:opacity-70"
              style={{ color: 'var(--text-4)' }}
            >
              <span className="mono text-[11px] tabular-nums">{MAINNET_ADDR.slice(0, 6)}…{MAINNET_ADDR.slice(-4)}</span>
              <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>

          {/* Right: FAQ button */}
          <button
            onClick={() => setFaqOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-500 transition-all duration-150 hover:bg-white/[0.05] active:scale-[0.98]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', color: 'var(--text-2)' }}
          >
            FAQ &amp; Protocol Spec
          </button>
        </footer>
      </main>

      <FAQModal open={faqOpen} onClose={() => setFaqOpen(false)} />
    </div>
  )
}
