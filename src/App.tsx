import { useState, useCallback } from 'react'
import { useAccount, useConnect } from 'wagmi'
import TelemetryBar from './components/TelemetryBar'
import CreateSLAPanel from './components/CreateSLAPanel'
import SLADeskPanel from './components/SLADeskPanel'
import FAQModal from './components/FAQModal'
import ConnectWalletModal from './components/ConnectWalletModal'
import { type SelectedNetwork } from './hooks/useBreachReads'
import { useSLATxHashes } from './hooks/useSLATxHashes'
import { ArrowUpRight } from 'lucide-react'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from './breach-contract'

const MAINNET_ADDR = '0x675d7feefce17095bab4538b03480227a74d3242'

export default function App() {
  const [refetchKey, setRefetchKey] = useState(0)
  const [faqOpen, setFaqOpen] = useState(false)
  const [connectModalOpen, setConnectModalOpen] = useState(false)

  // Canonical network state — decoupled from wallet chain.
  // Defaults to mainnet; auto-syncs when wallet switches to Arc chain.
  const [network, setNetwork] = useState<SelectedNetwork>('mainnet')
  const { chainId } = useAccount()
  const { connect, connectors } = useConnect()

  // When wallet switches to an Arc chain, sync the selectedNetwork
  // (but don't clobber if already correct)
  const handleNetworkChange = useCallback((n: SelectedNetwork) => {
    setNetwork(n)
  }, [])

  // Sync when wallet chainId changes to an Arc chain
  if (chainId === ARC_TESTNET_CHAIN_ID && network !== 'testnet') setNetwork('testnet')
  if (chainId === ARC_MAINNET_CHAIN_ID && network !== 'mainnet') setNetwork('mainnet')

  const { capture } = useSLATxHashes(network)

  const handleCreated = useCallback(() => {
    setRefetchKey((k) => k + 1)
  }, [])

  const handleConnectRequest = useCallback(() => {
    const injectedOnes = connectors.filter((c) => c.type === 'injected' || c.id === 'injected')
    if (injectedOnes.length === 1) {
      connect({ connector: injectedOnes[0] })
    } else {
      setConnectModalOpen(true)
    }
  }, [connectors, connect])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <TelemetryBar
        onFaqOpen={() => setFaqOpen(true)}
        network={network}
        onNetworkChange={handleNetworkChange}
        onConnectRequest={handleConnectRequest}
      />

      <main className="max-w-[1360px] mx-auto px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">
          <div className="lg:sticky lg:top-[89px]">
            <CreateSLAPanel onCreated={handleCreated} onCaptureTx={capture} />
          </div>
          <div>
            <SLADeskPanel
              refetchKey={refetchKey}
              onResolved={handleCreated}
              network={network}
              onNetworkChange={handleNetworkChange}
            />
          </div>
        </div>

        {/* Footer */}
        <footer
          className="mt-10 pt-4 pb-5 flex flex-wrap items-center justify-between gap-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
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
      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
    </div>
  )
}
