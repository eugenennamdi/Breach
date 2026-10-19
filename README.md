# Breach

**Deterministic SLA-Backed Escrow & Pull-Payment Revenue Splitting on Arc**

Breach solves the core trust problem in software-to-software and AI-agent payments: paying for a service call that hallucinates, times out, or silently fails. It enforces SLAs onchain — a micro-escrow locks USDC before the call, and the outcome is settled deterministically: provider and treasury receive their split on success, the caller receives a full automatic refund on breach.

Deployed on **Arc Mainnet** and **Arc Testnet**.

---

## Why Arc

Most SLA enforcement is impossible on legacy payment rails or high-gas L1s:

| Problem | Legacy Rails | High-Gas L1 | Arc |
|---|---|---|---|
| $0.01–$0.10 micro-escrow | Not possible | Gas cost exceeds principal | Sub-cent gas, native USDC |
| Sub-second finality | Settlement T+1 or T+2 | 12–15s block times | ~500ms finality |
| Native stablecoin | Fiat conversion required | ETH/MATIC required for gas | USDC **is** the gas token |
| Automatic refund on breach | Manual dispute, days | Feasible but expensive | Instant, deterministic |

Arc's defining properties that make Breach viable:

- **USDC as native gas**: On Arc, `msg.value` carries USDC at 18-decimal precision. Every escrow is a single payable call — no separate ERC-20 `approve` step. The caller pays gas and funds the escrow in the same transaction.
- **Sub-second finality**: $0.05 API call SLAs are enforced in milliseconds of actual latency vs. 12-second Ethereum block windows. At $0.05 per call and 1-second finality, high-frequency agent workflows become economically viable.
- **Predictable fees**: Stable USDC-denominated gas makes SLA economics calculable. A provider quoting `0.10 USDC / call` knows their net revenue to 6 decimal places before the call lands.

---

## Smart Contract Architecture

**`contracts/BreachSLA.sol`** — permissionless, ownerless, upgradeable by redeployment.

### Native USDC Payable Flow

Arc exposes USDC as the native gas token at 18-decimal precision (`1e17 wei = 0.10 USDC`). The contract uses `msg.value` exclusively — no ERC-20 `transferFrom`, no `approve` step. This makes every user action a single wallet signature.

```solidity
function createSLA(
    address _provider,
    address _treasury,
    uint256 _treasurySplitBps,   // e.g. 1500 = 15% to treasury
    uint256 _maxLatencyMs,        // e.g. 1200 = 1.2 second SLA
    uint256 _timeoutSeconds,      // deadline = block.timestamp + this
    string calldata _endpointName
) external payable returns (uint256 id)
```

Calling `createSLA` with `msg.value = 1e17` (0.10 USDC) atomically:
1. Validates all parameters.
2. Records the full `SLAContract` struct onchain.
3. Holds the USDC in contract storage.
4. Emits `SLACreated`.

### Dual-Party Resolution (`resolveSLA`)

Either the **caller** (service buyer) or the **provider** (service seller) may call `resolveSLA`. First to call wins — creating an honest-intent equilibrium: the provider confirms delivery, the caller confirms whether the SLA was met.

**Settlement path** (`_validSchema == true && _actualLatencyMs <= maxLatencyMs`):
- Status → `SETTLED`
- `pendingWithdrawals[provider] += providerAmount`
- `pendingWithdrawals[treasury] += treasuryAmount`
- Emits `SLASettled` with exact split amounts and payload hash.

**Breach path** (`_validSchema == false || _actualLatencyMs > maxLatencyMs`):
- Status → `BREACHED_REFUNDED`
- `pendingWithdrawals[caller] += amount` (100% refund)
- Emits `SLABreached` with reason string.

**Deadline-expired path** (called after `block.timestamp > deadline`):
- Same as breach path, auto-triggered inside `resolveSLA`.

### Basis-Point Revenue Splitting (`treasurySplitBps`)

```
treasuryAmount = amount * treasurySplitBps / 10000
providerAmount = amount - treasuryAmount
```

`treasurySplitBps` is set per-SLA at creation time and is immutable after. Maximum is 5000 bps (50%). The split is exact integer arithmetic — no floating-point precision loss, no rounding errors.

### Automatic Breach Refunds

Breach conditions are evaluated deterministically in `resolveSLA`:

| Condition | Outcome |
|---|---|
| `actualLatencyMs > maxLatencyMs` | 100% refund to caller |
| `validSchema == false` | 100% refund to caller |
| `block.timestamp > deadline` | 100% refund to caller |

### Timeout Protection (`claimTimeoutRefund`)

If neither party calls `resolveSLA` and the deadline passes, the caller reclaims 100% via:

```solidity
function claimTimeoutRefund(uint256 _id) external
```

Only callable by `sla.caller`. Reverts before the deadline (`DeadlineNotExpired`). Emits `SLABreached` with reason `"timeout_claimed"`.

### Audited Pull-Payment Vault (`pendingWithdrawals` + `withdraw()`)

Funds are never pushed directly to recipient addresses. Instead, all settlement paths credit an internal mapping:

```solidity
mapping(address => uint256) public pendingWithdrawals;
```

Recipients call `withdraw()` to pull their owed USDC:

```solidity
function withdraw() external nonReentrant
```

This eliminates the push-settlement griefing vector where a non-payable or blocklisted recipient address causes the entire resolution to revert and leaves the SLA permanently stuck. The `withdraw()` function uses strict CEI (Checks-Effects-Interactions): the pending balance is zeroed before the native transfer executes.

---

## Status & Events

```solidity
enum Status { ACTIVE, SETTLED, BREACHED_REFUNDED }

event SLACreated(uint256 indexed id, address indexed caller, address indexed provider,
    address treasury, uint256 amount, uint256 maxLatencyMs, uint256 deadline, string endpointName);

event SLASettled(uint256 indexed id, address indexed provider, address indexed treasury,
    uint256 providerAmount, uint256 treasuryAmount, uint256 actualLatencyMs, bytes32 payloadHash);

event SLABreached(uint256 indexed id, address indexed caller,
    uint256 amount, uint256 actualLatencyMs, string reason);

event Withdrawn(address indexed recipient, uint256 amount);
```

---

## Security & Testing

### Foundry Test Suite — 35/35 passing

Tests cover unit, fuzz, and stateful invariant scenarios:

| Category | Tests | Result |
|---|---|---|
| `createSLA` — struct population, validation | 8 | PASS |
| `resolveSLA` — 85/15 split, exact amounts, events | 6 | PASS |
| `resolveSLA` — high-latency breach, 100% refund | 4 | PASS |
| `resolveSLA` — schema-invalid breach | 2 | PASS |
| `resolveSLA` — deadline auto-refund, double-resolve, auth | 4 | PASS |
| `claimTimeoutRefund` — caller-only, timing, idempotency | 5 | PASS |
| `withdraw` — empty revert, post-settle, post-breach | 3 | PASS |
| `getStats` — accuracy after mixed settlement history | 1 | PASS |
| **Fuzz** — split sums to original for all (amount, bps) | 1 | PASS (256 runs) |
| **Invariant** — `balance ≥ sum(pendingWithdrawals)` | 1 | PASS (256×512 calls) |

Run tests:

```bash
forge test --match-path "contracts/test/BreachSLA.t.sol" -vv
```

### Slither Static Analysis

All Slither findings reviewed; all are false positives or informational noise:

- `arbitrary-send-eth` — `withdraw()` only sends to `msg.sender`. Not arbitrary.
- `incorrect-equality` — enum comparison is valid Solidity. Slither false positive.
- `uninitialized-local` — `uint256` locals are zero-initialized by spec. False positive.
- `timestamp` — deadline comparisons. Standard pattern; miner manipulation window is irrelevant at Arc's sub-second block times.

### Audit Findings (2 rounds)

Two critical/high findings were found and fixed before deployment:

1. **[High] Push-settlement griefing** — Replaced mandatory push transfers with pull-payment vault (`pendingWithdrawals` + `withdraw()`).
2. **[Critical] Unilateral resolution** — Changed caller-only resolution to dual-party (caller OR provider, first to call wins), eliminating the "caller always wins" attack.

---

## Deployed Addresses

| Network | Chain ID | Address | Explorer |
|---|---|---|---|
| **Arc Mainnet** | 5042 | `0x675d7feefce17095bab4538b03480227a74d3242` | [explorer.arc.io/address/0x675d7feefce17095bab4538b03480227a74d3242](https://explorer.arc.io/address/0x675d7feefce17095bab4538b03480227a74d3242) |
| **Arc Testnet** | 5042002 | `0x97b3d5b8b6fcc2cbb79daac53f057f3f34dfcfd4` | [explorer.testnet.arc.io](https://explorer.testnet.arc.io/address/0x97b3d5b8b6fcc2cbb79daac53f057f3f34dfcfd4) |

---

## Self-Deploy to Arc Mainnet

The `deploy_contract` platform tool targets testnet only. To deploy `BreachSLA.sol` to Arc Mainnet with your own wallet:

```bash
# 1. Build
forge build

# 2. Deploy (replace with your own private key and RPC)
forge create contracts/BreachSLA.sol:BreachSLA \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key <YOUR_PRIVATE_KEY> \
  --broadcast

# 3. Paste the resulting address into src/breach-contract.ts:
#    export const BREACH_SLA_ADDRESS_MAINNET = '0x...' as `0x${string}`
```

The frontend auto-detects chain: when the connected wallet is on Arc Mainnet (chainId 5042), it reads from `BREACH_SLA_ADDRESS_MAINNET` and points all explorer links to `https://explorer.arc.io`. On Arc Testnet (chainId 5042002), it uses the testnet address and testnet explorer.

---

## Frontend

Built with React + TypeScript + Vite + wagmi + ConnectKit.

```bash
bun install
bun run dev
```

Key views:

- **Telemetry bar** — live network indicator (mainnet/testnet), contract address, USDC balance, 4 KPI cells (total escrowed, settled payouts, breach refunds, success rate).
- **Deploy SLA-Backed Request** — preset quick-fills, manual form, "Use my wallet" address injection, native USDC amount input with chips, treasury split slider, latency slider, primary CTA.
- **Settlement Desk** — filterable tab view (All/Active/Settled/Breached), pull-payment claim bar showing claimable vault balance with one-click `withdraw()`, per-SLA cards with live resolver buttons, payout breakdowns, chain-aware explorer links.

---

## License

MIT
