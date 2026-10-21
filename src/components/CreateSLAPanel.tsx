import { useState, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { Loader2, ExternalLink, ChevronRight, TriangleAlert, CheckCheck } from 'lucide-react'
import {
  BREACH_SLA_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  DEMO_PROVIDER,
  DEMO_TREASURY,
  parseUsdcToNative,
  buildTxUrl,
  getContractAddress,
  isArcChain,
  parseOnchainError,
} from '../breach-contract'

interface Preset {
  label: string
  sub: string
  amount: string
  splitBps: number
  maxLatencyMs: number
  endpointName: string
}

const PRESETS: Preset[] = [
  {
    label: 'AI Risk Audit Endpoint',
    sub: '0.05 USDC · 1200 ms max · 85/15 split',
    amount: '0.05',
    splitBps: 1500,
    maxLatencyMs: 1200,
    endpointName: 'ai-risk-audit-v1',
  },
  {
    label: 'Onchain Price Oracle Feed',
    sub: '0.10 USDC · 500 ms max · 90/10 split',
    amount: '0.10',
    splitBps: 1000,
    maxLatencyMs: 500,
    endpointName: 'price-oracle-feed-v2',
  },
]

const CHIPS = ['0.01', '0.05', '0.10', '0.25']

// onCaptureTx reserved for future use (create tx id resolved by log indexer)
export default function CreateSLAPanel({ onCreated, onCaptureTx: _onCaptureTx }: { onCreated: () => void; onCaptureTx?: (slaId: string, hash: `0x${string}`, kind: 'create' | 'resolve') => void }) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  const [amount, setAmount] = useState('0.05')
  const [provider, setProvider] = useState('')
  const [treasury, setTreasury] = useState('')
  const [splitBps, setSplitBps] = useState(1500)
  const [maxLatencyMs, setMaxLatencyMs] = useState(1200)
  const [endpointName, setEndpointName] = useState('ai-risk-audit-v1')
  const [timeoutSeconds] = useState(3600)
  const [error, setError] = useState<string | null>(null)

  const onArc = isArcChain(chainId)
  const isWrongChain = isConnected && !onArc
  const activeChainId = chainId === ARC_MAINNET_CHAIN_ID ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const contractAddress = getContractAddress(chainId)

  const { writeContract, data: txHash, isPending, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const applyPreset = (p: Preset) => {
    setAmount(p.amount)
    setSplitBps(p.splitBps)
    setMaxLatencyMs(p.maxLatencyMs)
    setEndpointName(p.endpointName)
    setError(null)
    reset()
  }

  const handleCreate = useCallback(() => {
    setError(null)
    if (!isConnected) return
    if (isWrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    const value = parseUsdcToNative(amount)
    if (value === 0n) { setError('Enter a valid USDC amount.'); return }
    if (!provider || !/^0x[0-9a-fA-F]{40}$/.test(provider)) { setError('Enter a valid provider wallet address.'); return }
    if (!treasury || !/^0x[0-9a-fA-F]{40}$/.test(treasury)) { setError('Enter a valid treasury wallet address.'); return }
    writeContract(
      {
        address: contractAddress,
        abi: BREACH_SLA_ABI,
        functionName: 'createSLA',
        args: [provider as `0x${string}`, treasury as `0x${string}`, BigInt(splitBps), BigInt(maxLatencyMs), BigInt(timeoutSeconds), endpointName],
        value,
        chainId: activeChainId,
      },
      {
        onSuccess: () => onCreated(),
        onError: (err) => setError(parseOnchainError(err)),
      }
    )
  }, [isConnected, isWrongChain, switchChain, amount, provider, treasury, splitBps, maxLatencyMs, timeoutSeconds, endpointName, writeContract, onCreated, contractAddress, activeChainId])

  const providerPct = ((10000 - splitBps) / 100).toFixed(0)
  const treasuryPct = (splitBps / 100).toFixed(0)
  const isBusy = isPending || isConfirming

  return (
    <section className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

      {/* Panel header */}
      <div className="px-5 pt-5 pb-4">
        <h2 className="display text-[13px] font-600 tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Deploy SLA-Backed Request
        </h2>
        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Lock USDC into an onchain SLA escrow. Settles to provider on success, refunds on breach.
        </p>
      </div>

      <div className="flex flex-col gap-5 px-5 pb-5">

        {/* Presets */}
        <div className="flex flex-col gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="group flex items-center gap-3 px-3.5 py-3 rounded-lg text-left transition-all duration-150 hover:border-[var(--border-hover)] active:scale-[0.99]"
              style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-600" style={{ color: 'var(--text-primary)' }}>{p.label}</div>
                <div className="mono text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{p.sub}</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--text-4)' }}>manual config</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-2">
          <Label text="Deposit Amount" />
          <div className="flex items-baseline gap-2 px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)' }}>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v) }}
              placeholder="0.00"
              className="flex-1 bg-transparent mono text-[22px] font-600 tabular-nums outline-none placeholder:opacity-20"
              style={{ color: 'var(--text-primary)' }}
            />
            <span className="mono text-xs font-500" style={{ color: 'var(--text-3)' }}>USDC</span>
          </div>
          <div className="flex gap-1.5">
            {CHIPS.map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className="flex-1 py-1.5 rounded-md mono text-[11px] font-600 transition-all duration-100 hover:border-[var(--border-hover)] active:scale-95"
                style={{
                  background: amount === v ? 'var(--surface-raised)' : 'var(--surface-inset)',
                  border: `1px solid ${amount === v ? 'var(--border-strong)' : 'var(--border)'}`,
                  color: amount === v ? 'var(--text-primary)' : 'var(--text-3)',
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Provider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label text="Provider Wallet" />
            <div className="flex items-center gap-2">
              {address && (
                <button
                  onClick={() => setProvider(address)}
                  className="text-[11px] font-500 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-2)' }}
                >
                  Use my wallet →
                </button>
              )}
              <button
                onClick={() => setProvider(DEMO_PROVIDER)}
                className="text-[11px] font-500 transition-opacity hover:opacity-70"
                style={{ color: 'var(--text-3)' }}
              >
                Use demo →
              </button>
            </div>
          </div>
          <AddressInput value={provider} onChange={setProvider} />
        </div>

        {/* Treasury */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label text="Treasury Wallet" />
            <div className="flex items-center gap-2">
              {address && (
                <button
                  onClick={() => setTreasury(address !== provider ? address : DEMO_TREASURY)}
                  className="text-[11px] font-500 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-2)' }}
                >
                  Use my wallet →
                </button>
              )}
              <button
                onClick={() => setTreasury(DEMO_TREASURY)}
                className="text-[11px] font-500 transition-opacity hover:opacity-70"
                style={{ color: 'var(--text-3)' }}
              >
                Use demo →
              </button>
            </div>
          </div>
          <AddressInput value={treasury} onChange={setTreasury} />
        </div>

        {/* Split slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label text="Treasury Split" />
            <div className="flex items-center gap-2">
              <span className="mono text-[11px] tabular-nums" style={{ color: 'var(--text-2)' }}>{providerPct}%</span>
              <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>provider</span>
              <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>·</span>
              <span className="mono text-[11px] tabular-nums" style={{ color: 'var(--text-2)' }}>{treasuryPct}%</span>
              <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>treasury</span>
            </div>
          </div>
          <input type="range" min={0} max={5000} step={100} value={splitBps} onChange={(e) => setSplitBps(Number(e.target.value))} />
        </div>

        {/* Max latency slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label text="Max Allowed Latency" />
            <span className="mono text-[11px] tabular-nums font-600" style={{ color: 'var(--text-2)' }}>{maxLatencyMs.toLocaleString()} ms</span>
          </div>
          <input type="range" min={100} max={5000} step={100} value={maxLatencyMs} onChange={(e) => setMaxLatencyMs(Number(e.target.value))} />
        </div>

        {/* Endpoint name */}
        <div className="flex flex-col gap-1.5">
          <Label text="Endpoint Name" />
          <input
            type="text"
            value={endpointName}
            onChange={(e) => setEndpointName(e.target.value)}
            placeholder="my-api-endpoint-v1"
            className="w-full rounded-lg px-3.5 py-2.5 mono text-[12px] outline-none transition-colors"
            style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg" style={{ background: 'var(--breach-surface)', border: '1px solid var(--breach-border)' }}>
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--breach)' }} />
            <span className="text-[12px] leading-relaxed" style={{ color: 'var(--breach)' }}>{error}</span>
          </div>
        )}

        {/* Success */}
        {isSuccess && txHash && (
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg" style={{ background: 'var(--pass-surface)', border: '1px solid var(--pass-border)' }}>
            <CheckCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pass)' }} />
            <span className="text-[12px]" style={{ color: 'var(--pass)' }}>SLA created onchain</span>
            <a
              href={buildTxUrl(txHash, chainId)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 transition-opacity hover:opacity-70"
            >
              <span className="mono text-[11px]" style={{ color: 'var(--text-3)' }}>{txHash.slice(0, 10)}…</span>
              <ExternalLink className="w-3 h-3" style={{ color: 'var(--text-3)' }} />
            </a>
          </div>
        )}

        {/* CTA */}
        <button
          disabled={!isConnected || isBusy}
          onClick={handleCreate}
          className="w-full rounded-lg py-3 text-sm font-600 transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: isWrongChain ? '#27272a' : 'var(--text-primary)',
            color: '#09090b',
            letterSpacing: '-0.01em',
          }}
        >
          {!isConnected ? (
            'Connect wallet to continue'
          ) : isWrongChain ? (
            <span style={{ color: 'var(--text-primary)' }}>Switch to Arc Network</span>
          ) : isBusy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {isPending ? 'Confirm in wallet…' : 'Confirming on Arc…'}
            </span>
          ) : (
            'Lock USDC & Initialize SLA'
          )}
        </button>

        {address && isConnected && !isWrongChain && (
          <p className="text-center mono text-[10px]" style={{ color: 'var(--text-4)' }}>
            {address.slice(0, 6)}…{address.slice(-4)}
          </p>
        )}
      </div>
    </section>
  )
}

function Label({ text }: { text: string }) {
  return (
    <span className="text-[11px] font-500 tracking-wide uppercase" style={{ color: 'var(--text-3)', letterSpacing: '0.06em' }}>{text}</span>
  )
}

function AddressInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0x…"
      className="w-full rounded-lg px-3.5 py-2.5 mono text-[12px] outline-none transition-colors"
      style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
    />
  )
}
