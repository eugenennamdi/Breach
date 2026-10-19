/**
 * BreachSLA contract config — dual-chain: Arc Mainnet + Arc Testnet
 */

// ── Chain IDs ─────────────────────────────────────────────────────────────────

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

// ── Contract addresses ────────────────────────────────────────────────────────

/** Arc Mainnet deployment — live at 0x675d7feefce17095bab4538b03480227a74d3242 */
export const BREACH_SLA_ADDRESS_MAINNET_STATIC = '0x675d7feefce17095bab4538b03480227a74d3242' as `0x${string}`

/** Arc Testnet deployment */
export const BREACH_SLA_ADDRESS_TESTNET = '0x97b3d5b8b6fcc2cbb79daac53f057f3f34dfcfd4' as `0x${string}`

const LS_KEY = 'breach_mainnet_address'

/** Returns the mainnet address: localStorage override first, then the hardcoded live address */
export function getMainnetAddress(): `0x${string}` {
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (stored && /^0x[0-9a-fA-F]{40}$/.test(stored)) return stored as `0x${string}`
  } catch { /* SSR / storage blocked */ }
  return BREACH_SLA_ADDRESS_MAINNET_STATIC
}

/** Persist a freshly self-deployed mainnet address as a runtime override */
export function setMainnetAddress(addr: `0x${string}`): void {
  try { localStorage.setItem(LS_KEY, addr) } catch { /* ignore */ }
}

/** Always false — mainnet contract is live */
export function isMainnetPlaceholder(): boolean {
  return false
}

/** Resolve the active contract address for a given chain ID.
 *  Defaults to Arc Mainnet when no wallet is connected (chainId undefined). */
export function getContractAddress(chainId: number | undefined): `0x${string}` {
  if (chainId === ARC_TESTNET_CHAIN_ID) return BREACH_SLA_ADDRESS_TESTNET
  // undefined (no wallet) or ARC_MAINNET_CHAIN_ID → mainnet
  return getMainnetAddress()
}

/** True when the active chain is Arc Mainnet OR no wallet connected (default to mainnet) */
export function isMainnet(chainId: number | undefined): boolean {
  return chainId !== ARC_TESTNET_CHAIN_ID
}

/** True when the active chain is Arc (mainnet or testnet) */
export function isArcChain(chainId: number | undefined): boolean {
  return chainId === ARC_MAINNET_CHAIN_ID || chainId === ARC_TESTNET_CHAIN_ID
}

// ── Explorer helpers (chain-aware) ────────────────────────────────────────────

export function explorerBase(chainId: number | undefined): string {
  // Only use testnet explorer when explicitly on testnet; undefined → mainnet
  return chainId === ARC_TESTNET_CHAIN_ID
    ? 'https://explorer.testnet.arc.io'
    : 'https://explorer.arc.io'
}

export function buildTxUrl(txHash: string, chainId?: number): string {
  return `${explorerBase(chainId)}/tx/${txHash}`
}

export function buildAddressUrl(address: string, chainId?: number): string {
  return `${explorerBase(chainId)}/address/${address}`
}

// ── ABI ───────────────────────────────────────────────────────────────────────

export const BREACH_SLA_ABI = [
  // Write functions
  {
    type: 'function',
    name: 'createSLA',
    inputs: [
      { name: '_provider', type: 'address' },
      { name: '_treasury', type: 'address' },
      { name: '_treasurySplitBps', type: 'uint256' },
      { name: '_maxLatencyMs', type: 'uint256' },
      { name: '_timeoutSeconds', type: 'uint256' },
      { name: '_endpointName', type: 'string' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'resolveSLA',
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_actualLatencyMs', type: 'uint256' },
      { name: '_validSchema', type: 'bool' },
      { name: '_payloadHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimTimeoutRefund',
    inputs: [{ name: '_id', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // View functions
  {
    type: 'function',
    name: 'getAllSLAs',
    inputs: [],
    outputs: [
      {
        name: 'allSLAs',
        type: 'tuple[]',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'caller', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'treasury', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'treasurySplitBps', type: 'uint256' },
          { name: 'maxLatencyMs', type: 'uint256' },
          { name: 'actualLatencyMs', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'payloadHash', type: 'bytes32' },
          { name: 'endpointName', type: 'string' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: '_totalVolume', type: 'uint256' },
      { name: '_totalSettled', type: 'uint256' },
      { name: '_totalRefunded', type: 'uint256' },
      { name: '_settledCount', type: 'uint256' },
      { name: '_avgLatencyMs', type: 'uint256' },
      { name: '_successRate', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingWithdrawals',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // Events
  {
    type: 'event',
    name: 'SLACreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'treasury', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'maxLatencyMs', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
      { name: 'endpointName', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SLASettled',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'treasury', type: 'address', indexed: true },
      { name: 'providerAmount', type: 'uint256', indexed: false },
      { name: 'treasuryAmount', type: 'uint256', indexed: false },
      { name: 'actualLatencyMs', type: 'uint256', indexed: false },
      { name: 'payloadHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SLABreached',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'actualLatencyMs', type: 'uint256', indexed: false },
      { name: 'reason', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  // Errors
  { type: 'error', name: 'InvalidProvider', inputs: [] },
  { type: 'error', name: 'InvalidTreasury', inputs: [] },
  { type: 'error', name: 'InvalidAmount', inputs: [] },
  { type: 'error', name: 'InvalidSplitBps', inputs: [] },
  { type: 'error', name: 'InvalidDeadline', inputs: [] },
  { type: 'error', name: 'SLANotActive', inputs: [] },
  { type: 'error', name: 'NotAuthorized', inputs: [] },
  { type: 'error', name: 'DeadlineNotExpired', inputs: [] },
  { type: 'error', name: 'DeadlineExpired', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
] as const

// ── Demo wallets ──────────────────────────────────────────────────────────────

/** Replace with real addresses you control before production use */
export const DEMO_PROVIDER = '0x1234567890123456789012345678901234567890' as const
export const DEMO_TREASURY = '0x0987654321098765432109876543210987654321' as const

// ── Types ─────────────────────────────────────────────────────────────────────

export enum SLAStatus {
  ACTIVE = 0,
  SETTLED = 1,
  BREACHED_REFUNDED = 2,
}

export interface SLAContract {
  id: bigint
  caller: string
  provider: string
  treasury: string
  amount: bigint
  treasurySplitBps: bigint
  maxLatencyMs: bigint
  actualLatencyMs: bigint
  createdAt: bigint
  deadline: bigint
  payloadHash: string
  endpointName: string
  status: number
}

// ── Money helpers ─────────────────────────────────────────────────────────────

/** Format native 18-decimal Arc amount to USDC display */
export function formatNativeToUsdc(weiAmount: bigint): string {
  const usdc = Number(weiAmount) / 1e18
  if (usdc === 0) return '0.000000'
  if (usdc < 0.000001) return '< 0.000001'
  return usdc.toFixed(6).replace(/\.?0+$/, '') || '0'
}

/** Parse USDC display value (e.g. "0.05") to native 18-decimal wei */
export function parseUsdcToNative(usdcAmount: string): bigint {
  const parsed = parseFloat(usdcAmount)
  if (isNaN(parsed) || parsed <= 0) return 0n
  return BigInt(Math.round(parsed * 1e18))
}

export function formatAddress(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) return 'Insufficient USDC balance.'
  if (msg.includes('invalidamount')) return 'Amount must be greater than 0.'
  if (msg.includes('invalidprovider')) return 'Provider address is invalid.'
  if (msg.includes('invalidtreasury')) return 'Treasury address is invalid.'
  if (msg.includes('invalidsplitbps')) return 'Treasury split must be between 0% and 50%.'
  if (msg.includes('slanotactive')) return 'This SLA is no longer active.'
  if (msg.includes('notauthorized')) return 'Only the caller or provider can resolve this SLA.'
  if (msg.includes('deadlinenotexpired')) return 'Deadline has not yet expired.'
  if (msg.includes('reverted')) return 'Transaction reverted. Please check your inputs.'
  return 'Transaction failed. Please try again.'
}
