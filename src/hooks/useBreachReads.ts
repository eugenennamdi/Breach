/**
 * Dedicated read client for BreachSLA — decoupled from the wallet's current chain.
 *
 * Uses viem publicClients bound to fixed RPC URLs, so contract reads always
 * work regardless of which chain the connected wallet is on.
 *
 * Implements data fetching via useSyncExternalStore so no setState is called
 * inside effects — which satisfies the React Compiler lint rules in this project.
 */

import { useSyncExternalStore, useCallback } from 'react'
import { createPublicClient, http } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import {
  BREACH_SLA_ABI,
  BREACH_SLA_ADDRESS_MAINNET_STATIC,
  BREACH_SLA_ADDRESS_TESTNET,
  SLAContract,
} from '../breach-contract'

export type SelectedNetwork = 'mainnet' | 'testnet'

// ── Viem clients (one per network, module-level singletons) ──────────────────

const clients = {
  mainnet: createPublicClient({ chain: arc,        transport: http('https://rpc.mainnet.arc.io') }),
  testnet: createPublicClient({ chain: arcTestnet, transport: http('https://rpc.testnet.arc.io') }),
}

export function contractFor(net: SelectedNetwork): `0x${string}` {
  return net === 'mainnet' ? BREACH_SLA_ADDRESS_MAINNET_STATIC : BREACH_SLA_ADDRESS_TESTNET
}

export function chainIdFor(net: SelectedNetwork): number {
  return net === 'mainnet' ? 5042 : 5042002
}

// ── Generic external store factory ───────────────────────────────────────────
//
// Each "store" holds: a snapshot value, a set of listener callbacks, and a
// polling interval. React subscribes via useSyncExternalStore and gets the
// latest snapshot on every poll cycle without any setState inside an effect.

type Listener = () => void

interface ExternalStore<T> {
  subscribe: (listener: Listener) => () => void
  getSnapshot: () => T
  start: (intervalMs: number) => void
  stop: () => void
  fetch: () => Promise<void>
  invalidate: () => void
}

function makeStore<T>(initial: T, fetcher: () => Promise<T>): ExternalStore<T> {
  let snapshot: T = initial
  const listeners = new Set<Listener>()
  let intervalId: ReturnType<typeof setInterval> | null = null
  let started = false

  const notify = () => listeners.forEach((l) => l())

  const fetch = async () => {
    try {
      snapshot = await fetcher()
      notify()
    } catch { /* keep stale */ }
  }

  return {
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() {
      return snapshot
    },
    start(intervalMs: number) {
      if (started) return
      started = true
      void fetch()
      intervalId = setInterval(() => void fetch(), intervalMs)
    },
    stop() {
      if (intervalId !== null) clearInterval(intervalId)
      started = false
      intervalId = null
    },
    fetch,
    invalidate() {
      void fetch()
    },
  }
}

// ── Store registry — keyed by (network + storeKey + address) ─────────────────
// We create one store per unique key so stores are shared across hook calls
// (e.g. TelemetryBar and SLADeskPanel both asking for mainnet stats get
// the same store and only one RPC call per interval).

const storeRegistry = new Map<string, ExternalStore<unknown>>()

function getOrCreate<T>(key: string, initial: T, fetcher: () => Promise<T>, intervalMs: number): ExternalStore<T> {
  if (!storeRegistry.has(key)) {
    const store = makeStore<T>(initial, fetcher)
    storeRegistry.set(key, store)
    store.start(intervalMs)
  }
  return storeRegistry.get(key) as ExternalStore<T>
}

// ── Public hooks ─────────────────────────────────────────────────────────────

// useAllSLAs ──────────────────────────────────────────────────────────────────

export function useAllSLAs(network: SelectedNetwork, refetchKey: number) {
  const key = `allSLAs:${network}:${refetchKey}`

  const store = getOrCreate<SLAContract[]>(
    key,
    [],
    async () => {
      const raw = await clients[network].readContract({
        address: contractFor(network),
        abi: BREACH_SLA_ABI,
        functionName: 'getAllSLAs',
      })
      return [...(raw as SLAContract[])].reverse()
    },
    5000
  )

  const slas = useSyncExternalStore(store.subscribe, store.getSnapshot, () => [])
  const loading = slas.length === 0

  const refetch = useCallback(() => { store.invalidate() }, [store])
  return { slas, loading, refetch }
}

// useStats ────────────────────────────────────────────────────────────────────

type Stats = readonly [bigint, bigint, bigint, bigint, bigint, bigint] | null

export function useStats(network: SelectedNetwork): Stats {
  const key = `stats:${network}`

  const store = getOrCreate<Stats>(
    key,
    null,
    async () => {
      const raw = await clients[network].readContract({
        address: contractFor(network),
        abi: BREACH_SLA_ABI,
        functionName: 'getStats',
      })
      return raw
    },
    5000
  )

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null)
}

// usePendingWithdrawals ───────────────────────────────────────────────────────

export function usePendingWithdrawals(network: SelectedNetwork, address: `0x${string}` | undefined) {
  const key = `pending:${network}:${address ?? 'none'}`

  const store = getOrCreate<bigint>(
    key,
    0n,
    async () => {
      if (!address) return 0n
      const raw = await clients[network].readContract({
        address: contractFor(network),
        abi: BREACH_SLA_ABI,
        functionName: 'pendingWithdrawals',
        args: [address],
      })
      return raw
    },
    5000
  )

  const amount = useSyncExternalStore(store.subscribe, store.getSnapshot, () => 0n)
  const refetch = useCallback(() => { store.invalidate() }, [store])
  return { amount, refetch }
}

// useUsdcBalance ──────────────────────────────────────────────────────────────

const ERC20_BALANCE_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const

// Arc USDC ERC-20 precompile — same address on mainnet and testnet
const USDC_ADDR = '0x3600000000000000000000000000000000000000' as `0x${string}`

export function useUsdcBalance(network: SelectedNetwork, address: `0x${string}` | undefined): bigint | null {
  const key = `usdcBal:${network}:${address ?? 'none'}`

  const store = getOrCreate<bigint | null>(
    key,
    null,
    async () => {
      if (!address) return null
      try {
        const raw = await clients[network].readContract({
          address: USDC_ADDR,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        })
        return raw
      } catch { return null }
    },
    8000
  )

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null)
}
