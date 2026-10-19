import { useState, useEffect, useCallback } from 'react'
import { X, ExternalLink, ChevronDown } from 'lucide-react'

interface FAQModalProps {
  open: boolean
  onClose: () => void
}

interface FAQItem {
  q: string
  a: React.ReactNode
}

const MAINNET_ADDR = '0x675d7feefce17095bab4538b03480227a74d3242'
const TESTNET_ADDR = '0x97b3d5b8b6fcc2cbb79daac53f057f3f34dfcfd4'

const FAQS: FAQItem[] = [
  {
    q: 'What is Breach?',
    a: (
      <p>
        Breach is a deterministic, SLA-backed escrow and automated revenue-splitting protocol built on Arc. It enables
        humans, APIs, and autonomous AI agents to lock micro-USDC for software-to-software requests — settling and
        splitting funds only when latency and payload SLAs are met, and automatically refunding the caller on breach.
      </p>
    ),
  },
  {
    q: 'How does the onchain lifecycle work?',
    a: (
      <div className="flex flex-col gap-3">
        <Step n={1} title="Lock Escrow">
          The caller locks native USDC (<code>msg.value</code>) into <code>BreachSLA.sol</code> with a target{' '}
          <code>maxLatencyMs</code>, <code>provider</code> address, <code>treasury</code> address, and{' '}
          <code>treasurySplitBps</code> (basis points).
        </Step>
        <Step n={2} title="Deterministic Resolution">
          Either party resolves the SLA (<code>resolveSLA</code>). If <code>validSchema == true</code> and{' '}
          <code>actualLatencyMs &lt;= maxLatencyMs</code>, the contract splits the payout between the Provider and
          Shared Treasury. If latency spikes or fails validation, 100% of the USDC is credited back to the Caller.
        </Step>
        <Step n={3} title="Vault Withdrawal">
          Recipients claim their credited USDC anytime via the <strong>Withdraw USDC</strong> button in the Settlement
          Desk.
        </Step>
      </div>
    ),
  },
  {
    q: 'Why does Breach use a Pull-Payment Vault (withdraw()) instead of direct Push transfers?',
    a: (
      <p>
        During Arc Studio's two-round security audit, push-based settlement was upgraded to an audited
        Pull-Over-Push architecture (<code>pendingWithdrawals</code>). In multi-party revenue splits, if either the{' '}
        <code>provider</code> or <code>treasury</code> address is a smart contract that reverts on receive or is
        blocklisted, a push transfer would revert the entire transaction and lock funds permanently. Crediting an
        internal ledger guarantees deterministic settlement and eliminates griefing vectors.
      </p>
    ),
  },
  {
    q: 'What happens if a provider goes offline or ghosts an active request?',
    a: (
      <p>
        Every SLA escrow includes an onchain <code>deadline</code> timestamp. Once{' '}
        <code>block.timestamp &gt; deadline</code>, any resolution call automatically routes 100% of the locked USDC
        back to the caller — or the caller can trigger the 1-click{' '}
        <strong>"Reclaim Expired Escrow"</strong> (<code>claimTimeoutRefund</code>) button directly on the card.
      </p>
    ),
  },
  {
    q: 'Why build micro-SLA settlements on Arc Mainnet?',
    a: (
      <p>
        Enforcing a $0.01–$0.10 API or AI agent SLA is economically impossible on legacy payment rails (Stripe $0.30
        fixed fees) or high-gas blockchains. Arc's native USDC gas and sub-second finality allow micro-escrows,
        basis-point treasury splits, and automated breach refunds to execute for fractions of a cent.
      </p>
    ),
  },
  {
    q: 'Security, Testing & Onchain Verification',
    a: (
      <div className="flex flex-col gap-3">
        <AddressRow
          label="Arc Mainnet Contract"
          addr={MAINNET_ADDR}
          href={`https://explorer.arc.io/address/${MAINNET_ADDR}`}
        />
        <AddressRow
          label="Arc Testnet Contract"
          addr={TESTNET_ADDR}
          href={`https://explorer.testnet.arc.io/address/${TESTNET_ADDR}`}
        />
        <p>
          Verified with <strong>35/35 passing</strong> Foundry unit, fuzz, and stateful invariant tests
          (<code>address(this).balance &gt;= sum(pendingWithdrawals)</code>) and Slither static analysis inside Arc
          Studio.
        </p>
      </div>
    ),
  },
]

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className="mono text-[10px] font-700 shrink-0 w-5 h-5 rounded flex items-center justify-center mt-0.5"
        style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-3)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {n}
      </span>
      <div>
        <div className="text-[12px] font-600 mb-0.5" style={{ color: 'var(--text-primary)' }}>{title}</div>
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>{children}</div>
      </div>
    </div>
  )
}

function AddressRow({ label, addr, href }: { label: string; addr: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <span className="text-[11px] font-500" style={{ color: 'var(--text-3)' }}>{label}</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-2)' }}
      >
        <span className="mono text-[11px] tabular-nums">{addr.slice(0, 6)}…{addr.slice(-6)}</span>
        <ExternalLink className="w-3 h-3 shrink-0" />
      </a>
    </div>
  )
}

export default function FAQModal({ open, onClose }: FAQModalProps) {
  // First two items open by default
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0, 1]))

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) { next.delete(i) } else { next.add(i) }
      return next
    })

  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, handleKey])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: '#0c0c0e', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div>
            <h2 className="display text-[15px] font-700 tracking-tight" style={{ color: '#fafafa' }}>
              Protocol FAQ &amp; Architecture Spec
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Breach · SLA-Backed Escrow · Live on Arc Mainnet
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/[0.06] active:bg-white/[0.04]"
            style={{ border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable FAQ list */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-2">
          {FAQS.map((faq, i) => {
            const isOpen = expanded.has(i)
            return (
              <div
                key={i}
                className="rounded-xl overflow-hidden transition-colors duration-150"
                style={{ border: `1px solid ${isOpen ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)'}`, background: isOpen ? 'rgba(255,255,255,0.03)' : 'transparent' }}
              >
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="mono text-[10px] font-600 shrink-0 w-5 h-5 rounded flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-[13px] font-600 tracking-tight" style={{ color: isOpen ? '#fafafa' : 'rgba(255,255,255,0.7)' }}>
                      {faq.q}
                    </span>
                  </span>
                  <ChevronDown
                    className="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
                    style={{ color: 'rgba(255,255,255,0.3)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {isOpen && (
                  <div
                    className="px-4 pb-4 pt-0 text-[12px] leading-relaxed"
                    style={{ color: 'rgba(255,255,255,0.5)' }}
                  >
                    <div
                      className="pt-3"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      {faq.a}
                    </div>
                    {/* Inline code / strong styling via CSS vars */}
                    <style>{`
                      .faq-body code { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 11px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 1px 5px; color: rgba(255,255,255,0.7); }
                      .faq-body strong { color: rgba(255,255,255,0.75); font-weight: 600; }
                    `}</style>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 flex items-center justify-between shrink-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <span className="mono text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            35/35 Foundry tests passing · Slither audited
          </span>
          <a
            href={`https://explorer.arc.io/address/${MAINNET_ADDR}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 transition-opacity hover:opacity-60"
            style={{ color: 'rgba(255,255,255,0.3)' }}
          >
            <span className="mono text-[10px]">{MAINNET_ADDR.slice(0, 6)}…{MAINNET_ADDR.slice(-6)}</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  )
}
