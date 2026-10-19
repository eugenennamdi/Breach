import { useState, useCallback } from 'react'
import TelemetryBar from './components/TelemetryBar'
import CreateSLAPanel from './components/CreateSLAPanel'
import SLADeskPanel from './components/SLADeskPanel'

export default function App() {
  const [refetchKey, setRefetchKey] = useState(0)

  const handleCreated = useCallback(() => {
    setRefetchKey((k) => k + 1)
  }, [])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <TelemetryBar />

      <main className="max-w-[1360px] mx-auto px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">
          <div className="lg:sticky lg:top-[89px]">
            <CreateSLAPanel onCreated={handleCreated} />
          </div>
          <div>
            <SLADeskPanel refetchKey={refetchKey} onResolved={handleCreated} />
          </div>
        </div>

        <footer className="mt-10 pt-5 pb-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <span className="display text-[11px] font-600" style={{ color: 'var(--text-4)' }}>Breach</span>
            <span className="text-[11px]" style={{ color: 'var(--text-4)' }}>·</span>
            <span className="text-[11px]" style={{ color: 'var(--text-4)' }}>SLA-Backed Escrow · Arc Testnet</span>
          </div>
          <a
            href="https://explorer.testnet.arc.io/address/0x97b3d5b8b6fcc2cbb79daac53f057f3f34dfcfd4"
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[11px] transition-colors hover:opacity-60"
            style={{ color: 'var(--text-4)' }}
          >
            0x97b3…fd4
          </a>
        </footer>
      </main>
    </div>
  )
}
