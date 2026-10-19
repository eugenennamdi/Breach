import { useAccount, useReadContract, useDisconnect, useConnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { Copy, Check, ArrowUpRight, ChevronDown, LogOut, Plug } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import {
  BREACH_SLA_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  formatNativeToUsdc,
  formatAddress,
  buildAddressUrl,
  getContractAddress,
  isMainnet,
} from '../breach-contract'
import { getUsdc } from '../onchain-facts'
import { erc20Abi } from 'viem'

interface TelemetryBarProps {
  onFaqOpen: () => void
}

export default function TelemetryBar({ onFaqOpen }: TelemetryBarProps) {
  const { address, chainId } = useAccount()
  const { disconnect } = useDisconnect()
  const { connect } = useConnect()
  const [copied, setCopied] = useState(false)
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const walletMenuRef = useRef<HTMLDivElement>(null)

  const onMainnet = isMainnet(chainId)
  const activeChainId = onMainnet ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const contractAddress = getContractAddress(chainId)

  // Close wallet menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const usdcFact = getUsdc(activeChainId)

  const { data: usdcBalance } = useReadContract({
    address: usdcFact?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: activeChainId,
    query: { enabled: !!address && !!usdcFact },
  })

  const { data: stats } = useReadContract({
    address: contractAddress,
    abi: BREACH_SLA_ABI,
    functionName: 'getStats',
    chainId: activeChainId,
    query: { refetchInterval: 5000 },
  })

  const [totalVolume, totalSettled, totalRefunded, settledCount, , successRateBps] = stats ?? [0n, 0n, 0n, 0n, 0n, 0n]
  const successRatePct = (settledCount && settledCount > 0n) ? (Number(successRateBps) / 100).toFixed(1) : null
  const formattedBalance = usdcBalance != null ? (Number(usdcBalance) / 1e6).toFixed(2) : null

  const copyContract = () => {
    void navigator.clipboard.writeText(contractAddress).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  // ── Network switcher ──────────────────────────────────────────────────────
  const switchNetwork = async () => {
    const targetId = onMainnet ? ARC_TESTNET_CHAIN_ID : ARC_MAINNET_CHAIN_ID
    const targetHex = `0x${targetId.toString(16)}`
    try {
      await (window as unknown as { ethereum: { request: (args: { method: string; params?: unknown[] }) => Promise<void> } }).ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetHex }],
      })
    } catch (err) {
      // Chain not added yet (EIP-1193 code 4902) — add Arc Mainnet
      const code = (err as { code?: number })?.code
      if (code === 4902 && targetId === ARC_MAINNET_CHAIN_ID) {
        await (window as unknown as { ethereum: { request: (args: { method: string; params?: unknown[] }) => Promise<void> } }).ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: targetHex,
            chainName: 'Arc Mainnet',
            nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
            rpcUrls: ['https://rpc.mainnet.arc.io'],
            blockExplorerUrls: ['https://explorer.arc.io'],
          }],
        })
      }
    }
  }

  return (
    <header className="sticky top-0 z-50" style={{ background: 'rgba(9,9,11,0.88)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', borderBottom: '1px solid var(--border)' }}>

      {/* Primary nav row */}
      <div className="flex items-center justify-between px-5 h-12 gap-3">

        {/* Wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-5 h-5 rounded-[4px] flex items-center justify-center" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}>
            <span className="display text-[10px] font-700 leading-none" style={{ color: 'var(--text-primary)' }}>B</span>
          </div>
          <span className="display text-sm font-600 tracking-tight" style={{ color: 'var(--text-primary)' }}>Breach</span>
          <span className="hidden sm:block text-xs" style={{ color: 'var(--text-4)' }}>/</span>
          <span className="hidden sm:block text-xs" style={{ color: 'var(--text-3)' }}>SLA Escrow</span>
        </div>

        {/* Center: contract pill */}
        <div className="flex items-center gap-2 flex-1 justify-center min-w-0">

          {/* Contract address pill with label */}
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <span className="text-[10px] font-500 uppercase tracking-wider" style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>
              {onMainnet ? 'Mainnet Contract' : 'Testnet Contract'}
            </span>
            <span className="w-px h-3 shrink-0" style={{ background: 'var(--border-strong)' }} />
            <span className="mono text-[11px]" style={{ color: 'var(--text-3)' }}>
              {formatAddress(contractAddress)}
            </span>
            <button
              onClick={copyContract}
              className="p-0.5 rounded transition-opacity hover:opacity-70 active:opacity-50 flex items-center"
              aria-label="Copy contract address"
            >
              {copied
                ? <Check className="w-3 h-3" style={{ color: 'var(--pass)' }} />
                : <Copy className="w-3 h-3" style={{ color: 'var(--text-4)' }} />}
            </button>
            <a
              href={buildAddressUrl(contractAddress, chainId)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-0.5 rounded transition-opacity hover:opacity-70 flex items-center"
              aria-label="View on explorer"
            >
              <ArrowUpRight className="w-3 h-3" style={{ color: 'var(--text-4)' }} />
            </a>
          </div>

          {/* FAQ pill */}
          <button
            onClick={onFaqOpen}
            className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-500 transition-colors duration-150 hover:bg-white/[0.05]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          >
            <span className="mono text-[10px] font-600" style={{ color: 'var(--text-4)' }}>?</span>
            <span>FAQ</span>
          </button>

        </div>

        {/* Right: balance + wallet pill */}
        <div className="flex items-center gap-3 shrink-0">
          {address && formattedBalance !== null && (
            <div className="hidden sm:flex items-baseline gap-1">
              <span className="mono text-sm font-600 tabular-nums" style={{ color: 'var(--text-primary)' }}>{formattedBalance}</span>
              <span className="mono text-xs" style={{ color: 'var(--text-4)' }}>USDC</span>
            </div>
          )}

          {/* Wallet pill with dropdown */}
          <div className="relative" ref={walletMenuRef}>
            <button
              onClick={() => setWalletMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.03]"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}
            >
              {address ? (
                <>
                  <span className="w-4 h-4 rounded-full shrink-0 overflow-hidden">
                    <span
                      className="block w-full h-full rounded-full"
                      style={{
                        background: `linear-gradient(135deg, hsl(${parseInt(address.slice(2, 6), 16) % 360},60%,50%) 0%, hsl(${(parseInt(address.slice(2, 6), 16) + 120) % 360},60%,40%) 100%)`,
                      }}
                    />
                  </span>
                  <span className="mono text-[11px] font-500 tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {address.slice(0, 6)}…{address.slice(-4)}
                  </span>
                  <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-4)', transform: walletMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms' }} />
                </>
              ) : (
                <span className="text-[11px] font-500" style={{ color: 'var(--text-2)' }}>Connect wallet</span>
              )}
            </button>

            {/* Dropdown menu */}
            {walletMenuOpen && (
              <div
                className="absolute right-0 top-[calc(100%+6px)] w-52 rounded-xl overflow-hidden z-50"
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
              >
                {address ? (
                  <>
                    {/* Address row */}
                    <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-4)' }}>Connected</div>
                      <div className="mono text-[11px] break-all" style={{ color: 'var(--text-2)' }}>{address}</div>
                    </div>

                    {/* Switch network */}
                    <button
                      onClick={() => { setWalletMenuOpen(false); void switchNetwork() }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
                      style={{ color: 'var(--text-2)' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: onMainnet ? 'var(--text-3)' : 'var(--pass)' }}
                      />
                      {onMainnet ? 'Switch to Arc Testnet' : 'Switch to Arc Mainnet'}
                    </button>

                    {/* Disconnect */}
                    <button
                      onClick={() => { disconnect(); setWalletMenuOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
                      style={{ color: 'var(--breach)', borderTop: '1px solid var(--border)' }}
                    >
                      <LogOut className="w-3.5 h-3.5 shrink-0" />
                      Disconnect
                    </button>
                  </>
                ) : (
                  <>
                    {/* Connect injected (MetaMask / Rabby / Phantom EVM) */}
                    <button
                      onClick={() => { connect({ connector: injected() }); setWalletMenuOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
                      style={{ color: 'var(--text-2)' }}
                    >
                      <Plug className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                      Connect browser wallet
                      <span className="ml-auto text-[10px]" style={{ color: 'var(--text-4)' }}>MetaMask / Rabby</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI ticker row */}
      <div className="grid grid-cols-2 md:grid-cols-4" style={{ borderTop: '1px solid var(--border)' }}>
        <KpiCell label="Total Escrowed" value={`${formatNativeToUsdc(BigInt(totalVolume ?? 0n))} USDC`} />
        <KpiCell label="Settled Payouts" value={`${formatNativeToUsdc(BigInt(totalSettled ?? 0n))} USDC`} divider />
        <KpiCell label="Breach Refunds"  value={`${formatNativeToUsdc(BigInt(totalRefunded ?? 0n))} USDC`} divider />
        <KpiCell
          label="Success Rate"
          value={successRatePct ? `${successRatePct}%` : '—'}
          accent={successRatePct ? (Number(successRatePct) >= 75 ? 'pass' : 'breach') : undefined}
          divider
        />
      </div>
    </header>
  )
}

function KpiCell({ label, value, divider, accent }: { label: string; value: string; divider?: boolean; accent?: 'pass' | 'breach' }) {
  const valueColor = accent === 'pass' ? 'var(--pass)' : accent === 'breach' ? 'var(--breach)' : 'var(--text-primary)'
  return (
    <div className="flex items-center justify-between px-5 py-2.5 gap-3" style={{ borderLeft: divider ? '1px solid var(--border)' : undefined }}>
      <span className="text-[11px] font-500 tracking-wide uppercase" style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>{label}</span>
      <span className="mono text-xs font-600 tabular-nums" style={{ color: valueColor }}>{value}</span>
    </div>
  )
}
