/**
 * useSLATxHashes — resolves createTxHash and resolveTxHash for every SLA id.
 *
 * Sources (in priority order):
 *  1. Hardcoded seed map — known mainnet hashes found via on-chain scan,
 *     available instantly with zero network latency.
 *  2. localStorage — hashes captured in this browser session when the user
 *     created or resolved an SLA.
 *  3. viem getLogs — polls the last 2000 blocks (the safe window for Arc Mainnet
 *     RPC, which rejects ranges >9999 blocks and silently returns 0 for ranges
 *     that are too old). Only catches brand-new SLAs created in this session.
 *
 * The hook is built on useSyncExternalStore so it never calls setState inside
 * an effect, satisfying the react/set-state-in-effect lint rule.
 */

import { useSyncExternalStore, useEffect } from 'react'
import { createPublicClient, http, decodeEventLog, type Log } from 'viem'
import { arc as arcChain, arcTestnet as arcTestnetChain } from 'viem/chains'
import {
  BREACH_SLA_ADDRESS_MAINNET_STATIC,
  BREACH_SLA_ADDRESS_TESTNET,
  BREACH_SLA_ABI,
} from '../breach-contract'
import type { SelectedNetwork } from './useBreachReads'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SLATxEntry {
  createTxHash?: `0x${string}`
  resolveTxHash?: `0x${string}`
}

export type SLATxMap = Record<string, SLATxEntry>

// ---------------------------------------------------------------------------
// Hardcoded seed — exact mainnet tx hashes discovered via on-chain scan
// These are immediately available, no RPC call needed.
// ---------------------------------------------------------------------------

const MAINNET_SEED: SLATxMap = {
  '1': {
    createTxHash:  '0x1a4e8ba796c286690eb776c6e2d2ba1c0be6b3b106d32c471a79caf328d24c85',
    resolveTxHash: '0x21469dae5bed0989786bd0b956ad3c39938db7dc880b3a323b075f46c63190a9',
  },
  '2': {
    createTxHash:  '0xe73031bbf93436996d4dd4f9f4ee51ccb75fd87bceacbd9edc44f88ddec9eea7',
    resolveTxHash: '0xeb564118e5a4e765bafdacb4f9bd3c0670b43a881cc800c0f18b658743fca7f7',
  },
  '3': {
    createTxHash:  '0xc89f0fb9e6930c3e8a1a6609bb997428a033001b264d9313a2b42bbe55ab40cb',
    resolveTxHash: '0xcd0834fca67faf57e25259555883215e1a1dd6e7d7d10febd76ef3282f061a80',
  },
  '4': {
    createTxHash:  '0x00a5ef922401c3da46c643d5a571efdfce3c298b30bc66e8d6f4a347287245e4',
    resolveTxHash: '0x0259833dc10cceced993146b0a8a940a3ec414e989dc9d676ea334918a7e43dd',
  },
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = (network: SelectedNetwork) => `breach_tx:${network}`

function readLS(network: SelectedNetwork): SLATxMap {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY(network)) ?? '{}') as SLATxMap
  } catch {
    return {}
  }
}

function writeLS(network: SelectedNetwork, map: SLATxMap) {
  try {
    localStorage.setItem(LS_KEY(network), JSON.stringify(map))
  } catch {
    /* storage quota — ignore */
  }
}

// ---------------------------------------------------------------------------
// Module-level stores (one per network, created lazily)
// ---------------------------------------------------------------------------

interface Store {
  snapshot: SLATxMap
  listeners: Set<() => void>
  polling: ReturnType<typeof setInterval> | null
}

const stores: Partial<Record<SelectedNetwork, Store>> = {}

function getStore(network: SelectedNetwork): Store {
  if (!stores[network]) {
    // Merge seed + localStorage into initial snapshot
    const ls = readLS(network)
    const seed = network === 'mainnet' ? MAINNET_SEED : {}
    stores[network] = {
      snapshot: merge(seed, ls),
      listeners: new Set(),
      polling: null,
    }
  }
  return stores[network]
}

function merge(...maps: SLATxMap[]): SLATxMap {
  const out: SLATxMap = {}
  for (const m of maps) {
    for (const [id, entry] of Object.entries(m)) {
      out[id] = { ...out[id], ...entry }
    }
  }
  return out
}

function notify(store: Store) {
  for (const l of store.listeners) l()
}

function updateStore(network: SelectedNetwork, patch: SLATxMap) {
  const store = getStore(network)
  const next = merge(store.snapshot, patch)
  // Only notify if something actually changed
  if (JSON.stringify(next) !== JSON.stringify(store.snapshot)) {
    store.snapshot = next
    // Persist new hashes to localStorage
    writeLS(network, next)
    notify(store)
  }
}

// ---------------------------------------------------------------------------
// viem clients
// ---------------------------------------------------------------------------

const clients: Partial<Record<SelectedNetwork, ReturnType<typeof createPublicClient>>> = {}

function getClient(network: SelectedNetwork) {
  if (!clients[network]) {
    clients[network] = createPublicClient({
      chain: network === 'mainnet' ? arcChain : arcTestnetChain,
      transport: http(
        network === 'mainnet'
          ? 'https://rpc.mainnet.arc.io'
          : 'https://rpc.testnet.arc.io',
      ),
    })
  }
  return clients[network]
}

// ---------------------------------------------------------------------------
// Log polling — only the last 2000 blocks (safe window for Arc Mainnet RPC)
// ---------------------------------------------------------------------------

async function pollLogs(network: SelectedNetwork) {
  const client = getClient(network)
  const address: `0x${string}` =
    network === 'mainnet' ? BREACH_SLA_ADDRESS_MAINNET_STATIC : BREACH_SLA_ADDRESS_TESTNET
  try {
    const head = await client.getBlockNumber()
    const fromBlock = head > 2000n ? head - 2000n : 0n
    const logs: Log[] = await client.getLogs({ address, fromBlock, toBlock: head })
    if (logs.length === 0) return

    const patch: SLATxMap = {}
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: BREACH_SLA_ABI, data: log.data, topics: log.topics })
        const txHash = log.transactionHash as `0x${string}`
        if (!txHash) continue
        const args = decoded.args as Record<string, bigint | string | undefined>
        const rawId = args['id'] ?? args['_id']
        if (rawId === undefined) continue
        const id = typeof rawId === 'bigint' ? rawId.toString() : String(rawId)
        if (decoded.eventName === 'SLACreated') {
          patch[id] = { ...patch[id], createTxHash: txHash }
        } else if (decoded.eventName === 'SLASettled' || decoded.eventName === 'SLABreached') {
          patch[id] = { ...patch[id], resolveTxHash: txHash }
        }
      } catch {
        /* unknown event — skip */
      }
    }
    if (Object.keys(patch).length > 0) {
      updateStore(network, patch)
    }
  } catch {
    /* RPC error — silent, seed map covers known hashes */
  }
}

// ---------------------------------------------------------------------------
// Start/stop polling per store
// ---------------------------------------------------------------------------

function ensurePolling(network: SelectedNetwork) {
  const store = getStore(network)
  if (store.polling !== null) return
  // Initial poll
  void pollLogs(network)
  // Then every 15s
  store.polling = setInterval(() => void pollLogs(network), 15_000)
}

function stopPolling(network: SelectedNetwork) {
  const store = stores[network]
  if (!store || store.polling === null) return
  clearInterval(store.polling)
  store.polling = null
}

// ---------------------------------------------------------------------------
// useSyncExternalStore wrappers (no setState in effects)
// ---------------------------------------------------------------------------

function subscribe(network: SelectedNetwork, cb: () => void) {
  const store = getStore(network)
  store.listeners.add(cb)
  return () => store.listeners.delete(cb)
}

function getSnapshot(network: SelectedNetwork): SLATxMap {
  return getStore(network).snapshot
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export function useSLATxHashes(network: SelectedNetwork): {
  txMap: SLATxMap
  capture: (slaId: string, hash: `0x${string}`, kind: 'create' | 'resolve') => void
} {
  // Start polling when the hook mounts; stop on unmount if no other subscribers
  useEffect(() => {
    ensurePolling(network)
    return () => {
      const store = stores[network]
      if (store && store.listeners.size === 0) stopPolling(network)
    }
  }, [network])

  const txMap = useSyncExternalStore(
    (cb) => subscribe(network, cb),
    () => getSnapshot(network),
    () => (network === 'mainnet' ? MAINNET_SEED : {}),
  )

  const capture = (slaId: string, hash: `0x${string}`, kind: 'create' | 'resolve') => {
    const patch: SLATxMap = {
      [slaId]: kind === 'create' ? { createTxHash: hash } : { resolveTxHash: hash },
    }
    updateStore(network, patch)
  }

  return { txMap, capture }
}
