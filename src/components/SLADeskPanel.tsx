import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { Inbox, Loader2, ArrowDownToLine } from 'lucide-react'
import {
  BREACH_SLA_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  SLAContract,
  formatNativeToUsdc,
  getContractAddress,
  isArcChain,
  parseOnchainError,
} from '../breach-contract'
import SLACard from './SLACard'

type Tab = 'all' | 'active' | 'settled' | 'breached'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'active',   label: 'Active' },
  { id: 'settled',  label: 'Settled' },
  { id: 'breached', label: 'Breached' },
]

interface SLADeskPanelProps {
  refetchKey: number
  onResolved: () => void
}

export default function SLADeskPanel({ refetchKey, onResolved }: SLADeskPanelProps) {
  const [tab, setTab] = useState<Tab>('all')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const { address, chainId } = useAccount()

  const onArc = isArcChain(chainId)
  const activeChainId = chainId === ARC_MAINNET_CHAIN_ID ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const contractAddress = getContractAddress(chainId)

  // Pull-payment: read pending withdrawals for connected wallet
  const { data: pendingRaw, refetch: refetchPending } = useReadContract({
    address: contractAddress,
    abi: BREACH_SLA_ABI,
    functionName: 'pendingWithdrawals',
    args: address ? [address] : undefined,
    chainId: activeChainId,
    query: { enabled: !!address && onArc, refetchInterval: 5000 },
  })
  const pendingAmount = (pendingRaw) ?? 0n
  const hasPending = pendingAmount > 0n

  const { writeContract: doWithdraw, data: withdrawTxHash, isPending: isWithdrawPending, reset: resetWithdraw } = useWriteContract()
  const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawTxHash })

  const handleWithdraw = () => {
    setWithdrawError(null)
    resetWithdraw()
    doWithdraw(
      { address: contractAddress, abi: BREACH_SLA_ABI, functionName: 'withdraw', chainId: activeChainId },
      {
        onSuccess: () => void refetchPending(),
        onError: (e) => setWithdrawError(parseOnchainError(e)),
      }
    )
  }

  const { data: rawSLAs, isLoading, refetch } = useReadContract({
    address: contractAddress,
    abi: BREACH_SLA_ABI,
    functionName: 'getAllSLAs',
    chainId: activeChainId,
    query: { refetchInterval: 5000 },
  })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  if (refetchKey > 0) void refetch()

  const slas = ([...(rawSLAs ?? [])].reverse()) as unknown as SLAContract[]

  const counts = {
    all:      slas.length,
    active:   slas.filter(s => s.status === 0).length,
    settled:  slas.filter(s => s.status === 1).length,
    breached: slas.filter(s => s.status === 2).length,
  }

  const filtered = tab === 'all' ? slas
    : tab === 'active'   ? slas.filter(s => s.status === 0)
    : tab === 'settled'  ? slas.filter(s => s.status === 1)
    : slas.filter(s => s.status === 2)

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
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <span
              className="w-1.5 h-1.5 rounded-full live-dot"
              style={{ background: counts.active > 0 ? 'var(--pass)' : 'var(--text-4)' }}
            />
            <span className="mono text-[11px]" style={{ color: 'var(--text-3)' }}>{counts.active} active</span>
          </div>
        </div>

        {/* Pending withdrawals claim bar */}
        {address && onArc && (
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

        {/* Tab bar */}
        <div className="flex gap-0" style={{ borderBottom: '1px solid var(--border)' }}>
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
                <span
                  className="absolute bottom-0 left-0 right-0 h-px"
                  style={{ background: 'var(--text-primary)' }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-2.5">
        {isLoading && (
          <>
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl h-16 animate-pulse" style={{ background: 'var(--surface-inset)' }} />
            ))}
          </>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)' }}>
              <Inbox className="w-4.5 h-4.5" style={{ color: 'var(--text-4)' }} />
            </div>
            <p className="text-[12px]" style={{ color: 'var(--text-4)' }}>
              {tab === 'all' ? 'No SLAs deployed yet.' : `No ${tab} SLAs.`}
            </p>
          </div>
        )}

        {filtered.map((sla) => (
          <SLACard
            key={sla.id.toString()}
            sla={sla}
            chainId={chainId}
            onResolved={() => { onResolved(); void refetch() }}
          />
        ))}
      </div>
    </section>
  )
}
