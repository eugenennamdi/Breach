import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { Inbox, Loader2, ArrowDownToLine } from 'lucide-react'
import {
  BREACH_SLA_ABI,
  SLAContract,
  SLAStatus,
  formatNativeToUsdc,
  getContractAddress,
  parseOnchainError,
} from '../breach-contract'
import { useAllSLAs, usePendingWithdrawals, type SelectedNetwork } from '../hooks/useBreachReads'
import SLACard from './SLACard'

type Tab = 'all' | 'active' | 'settled' | 'breached'
type FeedMode = 'protocol' | 'mine'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'active',   label: 'Active' },
  { id: 'settled',  label: 'Settled' },
  { id: 'breached', label: 'Breached' },
]

interface SLADeskPanelProps {
  refetchKey: number
  onResolved: () => void
  network: SelectedNetwork
  onNetworkChange: (n: SelectedNetwork) => void
}

export default function SLADeskPanel({ refetchKey, onResolved, network, onNetworkChange }: SLADeskPanelProps) {
  const [tab, setTab] = useState<Tab>('all')
  const [feedMode, setFeedMode] = useState<FeedMode>('protocol')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const { address } = useAccount()
  const contractAddress = getContractAddress(network === 'mainnet' ? 5042 : 5042002)
  const chainId = network === 'mainnet' ? 5042 : 5042002

  // ── dedicated reads (decoupled from wallet chain) ─────────────────────────
  const { slas, loading, refetch } = useAllSLAs(network, refetchKey)
  const { amount: pendingAmount, refetch: refetchPending } = usePendingWithdrawals(network, address)
  const hasPending = pendingAmount > 0n

  // ── withdraw (wallet tx — still needs wallet on correct chain) ────────────
  const { writeContract: doWithdraw, data: withdrawTxHash, isPending: isWithdrawPending, reset: resetWithdraw } = useWriteContract()
  const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawTxHash })

  const handleWithdraw = () => {
    setWithdrawError(null)
    resetWithdraw()
    doWithdraw(
      { address: contractAddress, abi: BREACH_SLA_ABI, functionName: 'withdraw', chainId },
      {
        onSuccess: () => void refetchPending(),
        onError: (e) => setWithdrawError(parseOnchainError(e)),
      }
    )
  }

  // ── filter pipeline ───────────────────────────────────────────────────────
  // 1. Protocol / My SLAs
  const addrLower = address?.toLowerCase()
  const feedFiltered: SLAContract[] = feedMode === 'protocol'
    ? slas
    : slas.filter((s) =>
        addrLower && (
          s.caller.toLowerCase()   === addrLower ||
          s.provider.toLowerCase() === addrLower ||
          s.treasury.toLowerCase() === addrLower
        )
      )

  // 2. Status tab — compare as plain numbers to avoid enum-comparison lint errors
  const ACTIVE = SLAStatus.ACTIVE as number
  const SETTLED = SLAStatus.SETTLED as number
  const BREACHED = SLAStatus.BREACHED_REFUNDED as number

  const filtered = tab === 'all' ? feedFiltered
    : tab === 'active'   ? feedFiltered.filter(s => s.status === ACTIVE)
    : tab === 'settled'  ? feedFiltered.filter(s => s.status === SETTLED)
    : feedFiltered.filter(s => s.status === BREACHED)

  // counts from feed-filtered (not protocol-total) so tabs reflect the current feed
  const counts = {
    all:      feedFiltered.length,
    active:   feedFiltered.filter(s => s.status === ACTIVE).length,
    settled:  feedFiltered.filter(s => s.status === SETTLED).length,
    breached: feedFiltered.filter(s => s.status === BREACHED).length,
  }

  return (
    <section className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

      {/* Header */}
      <div className="px-5 pt-5 pb-0">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="display text-[13px] font-600 tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Settlement Desk
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Live onchain SLA escrows — click to expand and resolve.
            </p>
          </div>

          {/* Right: network toggle + live dot */}
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {/* Network toggle */}
            <div
              className="flex rounded-md overflow-hidden"
              style={{ border: '1px solid var(--border)', background: 'var(--surface-inset)' }}
            >
              {(['mainnet', 'testnet'] as SelectedNetwork[]).map((n) => (
                <button
                  key={n}
                  onClick={() => onNetworkChange(n)}
                  className="px-2.5 py-1 text-[10px] font-500 uppercase tracking-wider transition-colors duration-150"
                  style={{
                    color: network === n ? 'var(--text-primary)' : 'var(--text-4)',
                    background: network === n ? 'var(--surface-raised)' : 'transparent',
                    letterSpacing: '0.05em',
                  }}
                >
                  {n === 'mainnet' ? 'Mainnet' : 'Testnet'}
                </button>
              ))}
            </div>

            <span
              className="w-1.5 h-1.5 rounded-full live-dot"
              style={{ background: counts.active > 0 ? 'var(--pass)' : 'var(--text-4)' }}
            />
            <span className="mono text-[11px]" style={{ color: 'var(--text-3)' }}>{counts.active} active</span>
          </div>
        </div>

        {/* Pending withdrawals claim bar */}
        {address && (
          <div
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg mb-4"
            style={{
              background: hasPending ? 'var(--surface-raised)' : 'var(--surface-inset)',
              border: `1px solid ${hasPending ? 'var(--border-strong)' : 'var(--border)'}`,
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-500 uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>
                Claimable Vault Balance
              </div>
              <div className="flex items-baseline gap-1">
                <span className="mono text-sm font-600 tabular-nums" style={{ color: hasPending ? 'var(--text-primary)' : 'var(--text-4)' }}>
                  {formatNativeToUsdc(pendingAmount)}
                </span>
                <span className="mono text-[11px]" style={{ color: 'var(--text-4)' }}>USDC</span>
              </div>
            </div>
            <button
              disabled={!hasPending || isWithdrawPending || isWithdrawConfirming}
              onClick={handleWithdraw}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-600 transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: hasPending ? 'var(--text-primary)' : 'var(--surface)',
                color: hasPending ? '#09090b' : 'var(--text-4)',
                border: '1px solid var(--border)',
              }}
            >
              {(isWithdrawPending || isWithdrawConfirming) ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowDownToLine className="w-3 h-3" />
              )}
              Withdraw USDC
            </button>
          </div>
        )}

        {isWithdrawSuccess && (
          <div className="text-[11px] mb-3 px-1" style={{ color: 'var(--pass)' }}>
            Withdrawal confirmed — funds sent to your wallet.
          </div>
        )}
        {withdrawError && (
          <div className="text-[11px] mb-3 px-1" style={{ color: 'var(--breach)' }}>{withdrawError}</div>
        )}

        {/* Tab bar + Protocol/My SLAs toggle */}
        <div className="flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* Status tabs */}
          <div className="flex gap-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-500 transition-colors duration-150 relative"
                style={{ color: tab === t.id ? 'var(--text-primary)' : 'var(--text-4)' }}
              >
                {t.label}
                {counts[t.id] > 0 && (
                  <span
                    className="mono text-[9px] px-1 rounded"
                    style={{
                      background: tab === t.id ? 'rgba(255,255,255,0.1)' : 'var(--surface-inset)',
                      color: tab === t.id ? 'var(--text-2)' : 'var(--text-4)',
                    }}
                  >
                    {counts[t.id]}
                  </span>
                )}
                {tab === t.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-px" style={{ background: 'var(--text-primary)' }} />
                )}
              </button>
            ))}
          </div>

          {/* Feed mode segmented toggle */}
          <div
            className="flex rounded-md overflow-hidden mr-0 mb-1"
            style={{ border: '1px solid var(--border)', background: 'var(--surface-inset)' }}
          >
            <button
              onClick={() => setFeedMode('protocol')}
              className="px-3 py-1.5 text-[10px] font-500 transition-colors duration-150"
              style={{
                color: feedMode === 'protocol' ? 'var(--text-primary)' : 'var(--text-4)',
                background: feedMode === 'protocol' ? 'var(--surface-raised)' : 'transparent',
              }}
            >
              Protocol Feed
            </button>
            <button
              onClick={() => setFeedMode('mine')}
              className="px-3 py-1.5 text-[10px] font-500 transition-colors duration-150"
              style={{
                color: feedMode === 'mine' ? 'var(--text-primary)' : 'var(--text-4)',
                background: feedMode === 'mine' ? 'var(--surface-raised)' : 'transparent',
                borderLeft: '1px solid var(--border)',
              }}
            >
              My SLAs
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-2.5">
        {loading && (
          <>
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl h-16 animate-pulse" style={{ background: 'var(--surface-inset)' }} />
            ))}
          </>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)' }}>
              <Inbox className="w-4 h-4" style={{ color: 'var(--text-4)' }} />
            </div>
            <p className="text-[12px] text-center max-w-[260px]" style={{ color: 'var(--text-4)' }}>
              {feedMode === 'mine' && address
                ? `No SLAs found for ${address.slice(0, 6)}…${address.slice(-4)} — switch to Protocol Feed to view global onchain activity.`
                : feedMode === 'mine' && !address
                  ? 'Connect your wallet to see your SLAs.'
                  : tab === 'all'
                    ? 'No SLAs on this network yet.'
                    : `No ${tab} SLAs.`}
            </p>
          </div>
        )}

        {filtered.map((sla) => (
          <SLACard
            key={sla.id.toString()}
            sla={sla}
            chainId={chainId}
            connectedAddress={address}
            onResolved={() => { onResolved(); void refetch() }}
          />
        ))}
      </div>
    </section>
  )
}
