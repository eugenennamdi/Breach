/**
 * useSLATxHashes — resolves createTxHash and resolveTxHash for every SLA ID.
 *
 * Source priority:
 * 1. localStorage (instant — set when user creates/resolves in this browser session)
 * 2. Blockscout v2 API  (https://explorer.arc.io/api/v2/addresses/${addr}/logs)
 * 3. viem publicClient.getLogs fallback (recent blocks from chain head - 5000)
 *
 * Returns a Map<slaId (string), { createTxHash?, resolveTxHash? }>
 * and a `capture(slaId, hash, kind)` function for instant local capture.
 */

import { useSyncExternalStore, useCallback } from 'react'
import { createPublicClient, http, decodeEventLog } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { BREACH_SLA_ABI, BREACH_SLA_ADDRESS_MAINNET_STATIC, BREACH_SLA_ADDRESS_TESTNET } from '../breach-contract'
import type { SelectedNetwork } from './useBreachReads'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TxHashes {
  createTxHash?: `0x${string}`
  resolveTxHash?: `0x${string}`
}

export type TxHashMap = Map<string, TxHashes>

// ── Viem clients (shared with useBreachReads) ─────────────────────────────────

const clients: Record<SelectedNetwork, ReturnType<typeof createPublicClient>> = {
  mainnet: createPublicClient({ chain: arc,        transport: http('https://rpc.mainnet.arc.io') }),
  testnet: createPublicClient({ chain: arcTestnet, transport: http('https://rpc.testnet.arc.io') }),
}

function contractFor(net: SelectedNetwork): `0x${string}` {
  return net === 'mainnet' ? BREACH_SLA_ADDRESS_MAINNET_STATIC : BREACH_SLA_ADDRESS_TESTNET
}

function explorerApiBase(net: SelectedNetwork): string {
  return net === 'mainnet' ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io'
}

// ── localStorage cache ────────────────────────────────────────────────────────

const LS_KEY_PREFIX = 'breach_tx:'

function lsKey(net: SelectedNetwork): string {
  return `${LS_KEY_PREFIX}${net}`
}

function loadFromStorage(net: SelectedNetwork): TxHashMap {
  try {
    const raw = localStorage.getItem(lsKey(net))
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, TxHashes>
    return new Map(Object.entries(obj))
  } catch { return new Map() }
}

function saveToStorage(net: SelectedNetwork, map: TxHashMap): void {
  try {
    const obj: Record<string, TxHashes> = {}
    for (const [k, v] of map) obj[k] = v
    localStorage.setItem(lsKey(net), JSON.stringify(obj))
  } catch { /* ignore */ }
}

// ── SLA ID extraction helpers ─────────────────────────────────────────────────

// SLACreated: topics[1] = indexed slaId (uint256, left-padded 32 bytes)
// SLASettled: topics[1] = indexed slaId
// SLABreached: topics[1] = indexed slaId

function slaIdFromTopics(topics: readonly string[]): string | null {
  if (topics.length < 2) return null
  try {
    const raw = topics[1]
    const n = BigInt(raw)
    return n > 0n ? n.toString() : null
  } catch { return null }
}

// ── Blockscout v2 fetch ───────────────────────────────────────────────────────

interface BlockscoutLog {
  transaction_hash: string
  topics: string[]
}

interface BlockscoutLogsResponse {
  items?: BlockscoutLog[]
}

async function fetchBlockscoutLogs(net: SelectedNetwork, addr: string): Promise<TxHashMap> {
  const base = explorerApiBase(net)
  const url = `${base}/api/v2/addresses/${addr}/logs?limit=50`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Blockscout ${res.status}`)
  const data = (await res.json()) as BlockscoutLogsResponse
  const items = data.items ?? []

  const map: TxHashMap = new Map()

  // Resolve known event topic0 hashes by decoding against our ABI
  for (const log of items) {
    const txHash = log.transaction_hash as `0x${string}`
    const topics = log.topics as [`0x${string}`, ...`0x${string}`[]]
    if (!txHash || topics.length < 2) continue

    let slaId: string | null = null
    let isCreate = false
    let isResolve = false

    try {
      const decoded = decodeEventLog({ abi: BREACH_SLA_ABI, topics })
      const name = decoded.eventName
      isCreate  = name === 'SLACreated'
      isResolve = name === 'SLASettled' || name === 'SLABreached'
      if (isCreate || isResolve) {
        const args = decoded.args as Record<string, unknown>
        const idVal = args['id'] ?? args['slaId']
        if (typeof idVal === 'bigint') slaId = idVal.toString()
      }
    } catch {
      // Fallback: raw topic[1] extraction
      slaId = slaIdFromTopics(log.topics)
      // Determine type by topic[0] if known, otherwise mark create
      isCreate  = !isResolve
    }

    if (!slaId) continue
    const existing = map.get(slaId) ?? {}
    if (isCreate  && !existing.createTxHash)  map.set(slaId, { ...existing, createTxHash:  txHash })
    if (isResolve && !existing.resolveTxHash) map.set(slaId, { ...existing, resolveTxHash: txHash })
  }

  return map
}

// ── viem getLogs fallback ─────────────────────────────────────────────────────

async function fetchViemLogs(net: SelectedNetwork, addr: `0x${string}`): Promise<TxHashMap> {
  const client = clients[net]
  const headBlock = await client.getBlockNumber()
  const fromBlock = headBlock > 5000n ? headBlock - 5000n : 0n

  const logs = await client.getLogs({
    address: addr,
    fromBlock,
    toBlock: headBlock,
  })

  const map: TxHashMap = new Map()

  for (const log of logs) {
    const txHash = log.transactionHash
    if (!txHash) continue
    const topics = log.topics as [`0x${string}`, ...`0x${string}`[]]

    let slaId: string | null = null
    let isCreate = false
    let isResolve = false

    try {
      const decoded = decodeEventLog({ abi: BREACH_SLA_ABI, topics })
      const name = decoded.eventName
      isCreate  = name === 'SLACreated'
      isResolve = name === 'SLASettled' || name === 'SLABreached'
      if (isCreate || isResolve) {
        const args = decoded.args as Record<string, unknown>
        const idVal = args['id'] ?? args['slaId']
        if (typeof idVal === 'bigint') slaId = idVal.toString()
      }
    } catch {
      slaId = slaIdFromTopics(topics)
      isCreate = !isResolve
    }

    if (!slaId) continue
    const existing = map.get(slaId) ?? {}
    if (isCreate  && !existing.createTxHash)  map.set(slaId, { ...existing, createTxHash:  txHash })
    if (isResolve && !existing.resolveTxHash) map.set(slaId, { ...existing, resolveTxHash: txHash })
  }

  return map
}

// ── Merge helper — localStorage wins over remote ──────────────────────────────

function mergeInto(base: TxHashMap, incoming: TxHashMap): TxHashMap {
  const result: TxHashMap = new Map(base)
  for (const [id, hashes] of incoming) {
    const existing = result.get(id) ?? {}
    result.set(id, {
      createTxHash:  existing.createTxHash  ?? hashes.createTxHash,
      resolveTxHash: existing.resolveTxHash ?? hashes.resolveTxHash,
    })
  }
  return result
}

// ── External store ────────────────────────────────────────────────────────────

interface TxStore {
  subscribe: (l: () => void) => () => void
  getSnapshot: () => TxHashMap
  capture: (slaId: string, hash: `0x${string}`, kind: 'create' | 'resolve') => void
  fetch: () => Promise<void>
}

const storesByNet = new Map<SelectedNetwork, TxStore>()

function getOrCreateTxStore(net: SelectedNetwork): TxStore {
  if (storesByNet.has(net)) return storesByNet.get(net)!

  let snapshot: TxHashMap = loadFromStorage(net)
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const fetch = async () => {
    const addr = contractFor(net)
    let remote: TxHashMap = new Map()

    try {
      remote = await fetchBlockscoutLogs(net, addr)
    } catch {
      try {
        remote = await fetchViemLogs(net, addr)
      } catch { /* both sources failed — keep existing */ }
    }

    // localStorage (already in snapshot) wins over remote
    const merged = mergeInto(snapshot, remote)
    snapshot = merged
    saveToStorage(net, snapshot)
    notify()
  }

  // Start background polling every 12s (logs change infrequently)
  void fetch()
  setInterval(() => void fetch(), 12000)

  const store: TxStore = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() { return snapshot },
    capture(slaId, hash, kind) {
      const existing = snapshot.get(slaId) ?? {}
      if (kind === 'create')  snapshot = new Map(snapshot).set(slaId, { ...existing, createTxHash:  hash })
      if (kind === 'resolve') snapshot = new Map(snapshot).set(slaId, { ...existing, resolveTxHash: hash })
      saveToStorage(net, snapshot)
      notify()
    },
    fetch,
  }

  storesByNet.set(net, store)
  return store
}

// ── Public hook ───────────────────────────────────────────────────────────────

export function useSLATxHashes(network: SelectedNetwork): {
  txMap: TxHashMap
  capture: (slaId: string, hash: `0x${string}`, kind: 'create' | 'resolve') => void
} {
  const store = getOrCreateTxStore(network)
  const txMap = useSyncExternalStore(store.subscribe, store.getSnapshot, () => new Map<string, TxHashes>())
  const capture = useCallback(
    (slaId: string, hash: `0x${string}`, kind: 'create' | 'resolve') => store.capture(slaId, hash, kind),
    [store]
  )
  return { txMap, capture }
}
