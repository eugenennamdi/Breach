import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { Zap, AlertOctagon, Clock, CheckCircle2, XCircle, ExternalLink, Loader2, ChevronDown, Copy, Check, RotateCcw } from 'lucide-react'
import {
  BREACH_SLA_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  SLAStatus,
  SLAContract,
  formatNativeToUsdc,
  formatAddress,
  buildTxUrl,
  buildAddressUrl,
  getContractAddress,
  parseOnchainError,
} from '../breach-contract'

interface SLACardProps {
  sla: SLAContract
  chainId: number | undefined
  connectedAddress?: `0x${string}`
  onResolved: () => void
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  return { copied, copy }
}

function ExplorerLink({ address, chainId }: { address: string; chainId: number | undefined }) {
  return (
    <a
      href={buildAddressUrl(address, chainId)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 transition-opacity hover:opacity-60"
      style={{ color: 'var(--text-4)' }}
    >
      <span className="text-[10px]">View on Explorer</span>
      <ExternalLink className="w-2.5 h-2.5" />
    </a>
  )
}

export default function SLACard({ sla, chainId, connectedAddress, onResolved }: SLACardProps) {
  const addrLower = connectedAddress?.toLowerCase()
  const [expanded, setExpanded] = useState(true)
  const [passError, setPassError] = useState<string | null>(null)
  const [breachError, setBreachError] = useState<string | null>(null)
  const { copied: hashCopied, copy: copyHash } = useCopy()

  const activeChainId = chainId === ARC_MAINNET_CHAIN_ID ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const contractAddress = getContractAddress(chainId)

  const { writeContract: writePass, data: passTxHash, isPending: isPassPending, reset: resetPass } = useWriteContract()
  const { isLoading: isPassConfirming, isSuccess: isPassSuccess } = useWaitForTransactionReceipt({ hash: passTxHash })

  const { writeContract: writeBreach, data: breachTxHash, isPending: isBreachPending, reset: resetBreach } = useWriteContract()
  const { isLoading: isBreachConfirming, isSuccess: isBreachSuccess } = useWaitForTransactionReceipt({ hash: breachTxHash })

  const [reclaimError, setReclaimError] = useState<string | null>(null)
  const { writeContract: writeReclaim, data: reclaimTxHash, isPending: isReclaimPending, reset: resetReclaim } = useWriteContract()
  const { isLoading: isReclaimConfirming, isSuccess: isReclaimSuccess } = useWaitForTransactionReceipt({ hash: reclaimTxHash })

  const handleReclaim = () => {
    setReclaimError(null); resetReclaim()
    writeReclaim(
      { address: contractAddress, abi: BREACH_SLA_ABI, functionName: 'claimTimeoutRefund',
        args: [sla.id], chainId: activeChainId },
      { onSuccess: () => setTimeout(onResolved, 2000), onError: (e) => setReclaimError(parseOnchainError(e)) }
    )
  }

  const isActive   = sla.status === (SLAStatus.ACTIVE as number)
  const isSettled  = sla.status === (SLAStatus.SETTLED as number)
  const isBreached = sla.status === (SLAStatus.BREACHED_REFUNDED as number)

  const totalAmount    = sla.amount
  const treasuryAmount = (totalAmount * sla.treasurySplitBps) / 10000n
  const providerAmount = totalAmount - treasuryAmount
  const providerPct    = Number((10000n - sla.treasurySplitBps)) / 100
  const treasuryPct    = Number(sla.treasurySplitBps) / 100

  const deadlineSec  = Number(sla.deadline)
  const deadlineDate = new Date(deadlineSec * 1000)
  const [nowSec]     = useState<number>(() => Math.floor(Date.now() / 1000))
  const isExpired    = nowSec > deadlineSec

  const busy = isPassPending || isPassConfirming || isBreachPending || isBreachConfirming || isReclaimPending || isReclaimConfirming

  const handlePass = () => {
    setPassError(null); resetBreach()
    writePass(
      { address: contractAddress, abi: BREACH_SLA_ABI, functionName: 'resolveSLA',
        args: [sla.id, 340n, true, '0x0000000000000000000000000000000000000000000000000000000000000000'],
        chainId: activeChainId },
      { onSuccess: () => setTimeout(onResolved, 2000), onError: (e) => setPassError(parseOnchainError(e)) }
    )
  }

  const handleBreach = () => {
    setBreachError(null); resetPass()
    writeBreach(
      { address: contractAddress, abi: BREACH_SLA_ABI, functionName: 'resolveSLA',
        args: [sla.id, 2850n, false, '0x0000000000000000000000000000000000000000000000000000000000000000'],
        chainId: activeChainId },
      { onSuccess: () => setTimeout(onResolved, 2000), onError: (e) => setBreachError(parseOnchainError(e)) }
    )
  }

  const statusMap: Record<number, { label: string; dot: string; badge: string; badgeBg: string }> = {
    0: { label: 'Active',   dot: 'var(--text-2)',  badge: 'var(--text-2)',  badgeBg: 'rgba(255,255,255,0.06)' },
    1: { label: 'Settled',  dot: 'var(--pass)',    badge: 'var(--pass)',    badgeBg: 'var(--pass-surface)' },
    2: { label: 'Breached', dot: 'var(--breach)',  badge: 'var(--breach)',  badgeBg: 'var(--breach-surface)' },
  }
  const sm = statusMap[sla.status] ?? statusMap[0]

  const latencyPassed = sla.actualLatencyMs > 0n && sla.actualLatencyMs <= sla.maxLatencyMs
  const latencyFailed = sla.actualLatencyMs > 0n && sla.actualLatencyMs > sla.maxLatencyMs

  return (
    <article
      className="rounded-xl overflow-hidden transition-colors duration-200"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Card header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-white/[0.02]"
        style={{ borderBottom: expanded ? '1px solid var(--border)' : undefined }}
      >
        <div className="shrink-0 flex items-center justify-center w-7 h-7">
          {isActive ? (
            <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: sm.dot }} />
          ) : isSettled ? (
            <CheckCircle2 className="w-4 h-4" style={{ color: sm.dot }} />
          ) : (
            <XCircle className="w-4 h-4" style={{ color: sm.dot }} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono text-[11px]" style={{ color: 'var(--text-4)' }}>#{sla.id.toString()}</span>
            <span
              className="text-[10px] font-600 px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{ background: sm.badgeBg, color: sm.badge, letterSpacing: '0.07em' }}
            >
              {sm.label}
            </span>
            {isExpired && isActive && (
              <span className="text-[10px] font-500 px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--warn-surface)', color: 'var(--warn)', letterSpacing: '0.07em' }}>
                Expired
              </span>
            )}
          </div>
          <div className="text-[12px] font-500 mt-0.5 truncate" style={{ color: 'var(--text-2)' }}>
            {sla.endpointName || 'Unnamed Endpoint'}
          </div>
        </div>

        <div className="text-right shrink-0 mr-1">
          <div className="mono text-sm font-600 tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {formatNativeToUsdc(totalAmount)}
            <span className="text-[11px] ml-1" style={{ color: 'var(--text-4)' }}>USDC</span>
          </div>
          <div className="mono text-[10px] tabular-nums mt-0.5" style={{ color: 'var(--text-4)' }}>
            {providerPct.toFixed(0)}/{treasuryPct.toFixed(0)} split
          </div>
        </div>

        <ChevronDown
          className="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
          style={{ color: 'var(--text-4)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 py-4 flex flex-col gap-4">

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <MetaRow label="Caller"   value={formatAddress(sla.caller)}   mono you={addrLower === sla.caller.toLowerCase()} />
            <MetaRow label="Provider" value={formatAddress(sla.provider)} mono you={addrLower === sla.provider.toLowerCase()} />
            <MetaRow label="Treasury" value={formatAddress(sla.treasury)} mono you={addrLower === sla.treasury.toLowerCase()} />
            <MetaRow
              label="Deadline"
              value={deadlineDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              warn={isActive && isExpired}
            />
            <MetaRow label="Max Latency" value={`${Number(sla.maxLatencyMs).toLocaleString()} ms`} mono />
            {sla.actualLatencyMs > 0n && (
              <MetaRow
                label="Actual Latency"
                value={`${Number(sla.actualLatencyMs).toLocaleString()} ms`}
                mono
                pass={latencyPassed}
                fail={latencyFailed}
              />
            )}
          </div>

          {/* Settled payout table */}
          {isSettled && (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--pass-border)' }}>
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'var(--pass-surface)', borderBottom: '1px solid var(--pass-border)' }}>
                <span className="text-[10px] font-600 uppercase tracking-wider" style={{ color: 'var(--pass)', letterSpacing: '0.07em' }}>Payout Breakdown</span>
                {sla.actualLatencyMs > 0n && (
                  <span className="mono text-[10px]" style={{ color: 'var(--pass)' }}>
                    {Number(sla.actualLatencyMs).toLocaleString()} ms ≤ {Number(sla.maxLatencyMs).toLocaleString()} ms
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5 flex flex-col gap-1.5">
                <PayoutRow label={`Provider (${providerPct.toFixed(0)}%)`} value={`${formatNativeToUsdc(providerAmount)} USDC`} />
                <PayoutRow label={`Treasury (${treasuryPct.toFixed(0)}%)`} value={`${formatNativeToUsdc(treasuryAmount)} USDC`} />
                <div className="h-px my-0.5" style={{ background: 'var(--border)' }} />
                <PayoutRow label="Total Settled" value={`${formatNativeToUsdc(totalAmount)} USDC`} bold />
                <div className="flex justify-end mt-1">
                  <ExplorerLink address={contractAddress} chainId={chainId} />
                </div>
              </div>
            </div>
          )}

          {/* Breached refund table */}
          {isBreached && (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--breach-border)' }}>
              <div className="px-3 py-2" style={{ background: 'var(--breach-surface)', borderBottom: '1px solid var(--breach-border)' }}>
                <span className="text-[10px] font-600 uppercase tracking-wider" style={{ color: 'var(--breach)', letterSpacing: '0.07em' }}>Refund Issued</span>
              </div>
              <div className="px-3 py-2.5">
                <PayoutRow label="Refunded to caller (100%)" value={`${formatNativeToUsdc(totalAmount)} USDC`} bold fail />
                {sla.actualLatencyMs > 0n && (
                  <div className="mt-1.5 mono text-[10px]" style={{ color: 'var(--breach)' }}>
                    {Number(sla.actualLatencyMs).toLocaleString()} ms &gt; {Number(sla.maxLatencyMs).toLocaleString()} ms SLA
                  </div>
                )}
                <div className="flex justify-end mt-1">
                  <ExplorerLink address={contractAddress} chainId={chainId} />
                </div>
              </div>
            </div>
          )}

          {/* Active: resolver buttons */}
          {isActive && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-500 uppercase tracking-wider" style={{ color: 'var(--text-4)', letterSpacing: '0.07em' }}>Live Endpoint Simulator & Resolver</span>

              <div className="flex flex-col gap-1">
                <button
                  disabled={busy}
                  onClick={handlePass}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-600 transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
                >
                  {(isPassPending || isPassConfirming) ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />{isPassPending ? 'Confirm in wallet…' : 'Confirming…'}</>
                  ) : (
                    <><Zap className="w-3.5 h-3.5" style={{ color: 'var(--pass)' }} />Execute Fast Response — 340 ms · Pass SLA &amp; Split USDC</>
                  )}
                </button>
                {isPassSuccess && passTxHash && (
                  <TxReceipt hash={passTxHash} label="SLA settled · split credited" variant="pass" onCopy={copyHash} copied={hashCopied} chainId={chainId} />
                )}
                {passError && <ErrLine msg={passError} />}
              </div>

              <div className="flex flex-col gap-1">
                <button
                  disabled={busy}
                  onClick={handleBreach}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-600 transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  {(isBreachPending || isBreachConfirming) ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />{isBreachPending ? 'Confirm in wallet…' : 'Confirming…'}</>
                  ) : (
                    <><AlertOctagon className="w-3.5 h-3.5" style={{ color: 'var(--breach)' }} />Simulate Latency Spike — 2,850 ms · Breach &amp; Auto-Refund</>
                  )}
                </button>
                {isBreachSuccess && breachTxHash && (
                  <TxReceipt hash={breachTxHash} label="SLA breached · refund credited" variant="breach" onCopy={copyHash} copied={hashCopied} chainId={chainId} />
                )}
                {breachError && <ErrLine msg={breachError} />}
              </div>
            </div>
          )}

          {/* Expired timeout: one-click reclaim */}
          {isActive && isExpired && (
            <div className="flex flex-col gap-1.5">
              <button
                disabled={busy}
                onClick={handleReclaim}
                className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-600 transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--warn-surface)', border: '1px solid var(--warn-border)', color: 'var(--warn)' }}
              >
                {(isReclaimPending || isReclaimConfirming) ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />{isReclaimPending ? 'Confirm in wallet…' : 'Confirming…'}</>
                ) : (
                  <><Clock className="w-3.5 h-3.5" />Reclaim Expired Escrow — {formatNativeToUsdc(totalAmount)} USDC</>
                )}
              </button>
              {isReclaimSuccess && reclaimTxHash && (
                <TxReceipt hash={reclaimTxHash} label="Timeout refund credited" variant="breach" onCopy={copyHash} copied={hashCopied} chainId={chainId} />
              )}
              {reclaimError && <ErrLine msg={reclaimError} />}
              <div className="flex items-center gap-1.5 px-1">
                <RotateCcw className="w-3 h-3 shrink-0" style={{ color: 'var(--warn)' }} />
                <span className="text-[10px]" style={{ color: 'var(--warn)' }}>
                  Deadline passed — funds locked until reclaimed.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetaRow({ label, value, mono, warn, pass, fail, you }: { label: string; value: string; mono?: boolean; warn?: boolean; pass?: boolean; fail?: boolean; you?: boolean }) {
  const color = fail ? 'var(--breach)' : pass ? 'var(--pass)' : warn ? 'var(--warn)' : 'var(--text-2)'
  return (
    <div>
      <div className="text-[10px] font-500 uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>{label}</div>
      <div className="flex items-center gap-1.5">
        <div className={`text-[12px] font-500 tabular-nums ${mono ? 'mono' : ''}`} style={{ color }}>{value}</div>
        {you && (
          <span
            className="text-[9px] font-700 px-1 py-px rounded uppercase tracking-widest"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-3)', letterSpacing: '0.1em' }}
          >
            YOU
          </span>
        )}
      </div>
    </div>
  )
}

function PayoutRow({ label, value, bold, fail }: { label: string; value: string; bold?: boolean; fail?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`mono text-[11px] tabular-nums ${bold ? 'font-700' : 'font-500'}`} style={{ color: fail ? 'var(--breach)' : 'var(--text-2)' }}>{value}</span>
    </div>
  )
}

function TxReceipt({ hash, label, variant, onCopy, copied, chainId }: { hash: `0x${string}`; label: string; variant: 'pass' | 'breach'; onCopy: (s: string) => void; copied: boolean; chainId: number | undefined }) {
  const c = variant === 'pass' ? 'var(--pass)' : 'var(--breach)'
  const bg = variant === 'pass' ? 'var(--pass-surface)' : 'var(--breach-surface)'
  const border = variant === 'pass' ? 'var(--pass-border)' : 'var(--breach-border)'
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: bg, border: `1px solid ${border}` }}>
      <span className="text-[11px] flex-1" style={{ color: c }}>{label}</span>
      <button onClick={() => onCopy(hash)} className="flex items-center gap-1 transition-opacity hover:opacity-70">
        {copied ? <Check className="w-3 h-3" style={{ color: c }} /> : <Copy className="w-3 h-3" style={{ color: c }} />}
        <span className="mono text-[10px]" style={{ color: c }}>{hash.slice(0, 8)}…{hash.slice(-6)}</span>
      </button>
      <a href={buildTxUrl(hash, chainId)} target="_blank" rel="noopener noreferrer" className="transition-opacity hover:opacity-70">
        <ExternalLink className="w-3 h-3" style={{ color: c }} />
      </a>
    </div>
  )
}

function ErrLine({ msg }: { msg: string }) {
  return <p className="text-[11px] px-1 pt-0.5" style={{ color: 'var(--breach)' }}>{msg}</p>
}
