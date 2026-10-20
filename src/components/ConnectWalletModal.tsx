/**
 * ConnectWalletModal — EIP-6963 multi-wallet picker.
 * Single injected wallet: immediate connect on first click (no modal).
 * Multiple wallets detected: opens a Linear-style centered modal.
 */

import { useEffect, useRef } from 'react'
import { useConnect } from 'wagmi'
import { X, Plug } from 'lucide-react'

interface ConnectWalletModalProps {
  open: boolean
  onClose: () => void
}

export default function ConnectWalletModal({ open, onClose }: ConnectWalletModalProps) {
  const { connect, connectors } = useConnect()
  const overlayRef = useRef<HTMLDivElement>(null)

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  // Filter to browser-injected connectors (EIP-1193 / EIP-6963)
  const injectedConnectors = connectors.filter(
    (c) => c.type === 'injected' || c.id === 'injected' || c.id.startsWith('io.') || c.id.startsWith('com.')
  )

  // Friendly display names for known wallets
  function walletLabel(id: string, name: string): string {
    if (id.includes('metamask') || name.toLowerCase().includes('metamask')) return 'MetaMask'
    if (id.includes('coinbase') || name.toLowerCase().includes('coinbase')) return 'Coinbase Wallet'
    if (id.includes('rabby') || name.toLowerCase().includes('rabby')) return 'Rabby'
    if (id.includes('phantom') || name.toLowerCase().includes('phantom')) return 'Phantom'
    if (id.includes('brave') || name.toLowerCase().includes('brave')) return 'Brave Wallet'
    return name || 'Browser Wallet'
  }

  const items = injectedConnectors.length > 0 ? injectedConnectors : connectors

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="relative w-full max-w-[360px] mx-4 rounded-2xl overflow-hidden"
        style={{ background: '#0c0c0e', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <h3 className="display text-[14px] font-600 tracking-tight" style={{ color: '#fafafa' }}>Connect a Wallet</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Choose a browser wallet to continue</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.07]"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {/* Wallet list */}
        <div className="p-3 flex flex-col gap-1">
          {items.map((connector) => (
            <button
              key={connector.id}
              onClick={() => { connect({ connector }); onClose() }}
              className="flex items-center gap-3.5 w-full px-3.5 py-3 rounded-xl text-left transition-all duration-150 hover:bg-white/[0.05] active:scale-[0.99]"
              style={{ border: '1px solid transparent' }}
              onMouseEnter={(e) => { (e.currentTarget).style.borderColor = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { (e.currentTarget).style.borderColor = 'transparent' }}
            >
              {/* Wallet icon — use connector icon if available, else generic */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {connector.icon ? (
                  <img src={connector.icon} alt={connector.name} className="w-5 h-5 rounded-md object-contain" />
                ) : (
                  <Plug className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.4)' }} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-500" style={{ color: '#fafafa' }}>
                  {walletLabel(connector.id, connector.name)}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {connector.type === 'injected' ? 'Browser extension' : connector.type}
                </div>
              </div>

              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />
            </button>
          ))}
        </div>

        {/* Footer note */}
        <div className="px-5 pb-4 pt-1">
          <p className="text-[10px] text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Connecting switches your wallet to Arc Mainnet (chain 5042)
          </p>
        </div>
      </div>
    </div>
  )
}
