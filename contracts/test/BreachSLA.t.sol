// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {BreachSLA} from "../BreachSLA.sol";

contract BreachSLATest is Test {
    BreachSLA internal sla;

    address internal caller  = makeAddr("caller");
    address internal provider = makeAddr("provider");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    // On Arc: 1e17 wei == 0.10 USDC (18-decimal native gas token)
    uint256 internal constant AMOUNT      = 1e17;          // 0.10 USDC
    uint256 internal constant SPLIT_BPS   = 1500;          // 15 %
    uint256 internal constant MAX_LAT     = 1200;          // 1200 ms
    uint256 internal constant TIMEOUT     = 3600;          // 1 hour
    string  internal constant ENDPOINT    = "api.arc.test";

    // Pre-computed splits for AMOUNT with SPLIT_BPS=1500
    uint256 internal constant TREASURY_AMT = 15_000_000_000_000_000; // 15 % of 1e17
    uint256 internal constant PROVIDER_AMT = 85_000_000_000_000_000; // 85 % of 1e17

    // ── setUp ──────────────────────────────────────────────────────────────────
    function setUp() public {
        sla = new BreachSLA();
        // Fund test addresses with native (USDC-as-gas) balance
        vm.deal(caller,   10 ether);
        vm.deal(provider, 1  ether);
        vm.deal(treasury, 1  ether);
        vm.deal(stranger, 1  ether);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// Create a standard SLA and return its id.
    function _createSLA() internal returns (uint256 id) {
        vm.prank(caller);
        id = sla.createSLA{value: AMOUNT}(
            provider,
            treasury,
            SPLIT_BPS,
            MAX_LAT,
            TIMEOUT,
            ENDPOINT
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. Creating a funded SLA with native USDC
    // ═══════════════════════════════════════════════════════════════════════════

    function test_CreateSLA_StructPopulatedCorrectly() public {
        uint256 tsBefore = block.timestamp;
        uint256 id = _createSLA();

        assertEq(id, 1, "returned id should be 1");
        assertEq(sla.slaCount(), 1, "slaCount == 1");
        assertEq(sla.totalVolume(), AMOUNT, "totalVolume updated");

        BreachSLA.SLAContract memory s = sla.getSLA(id);
        assertEq(s.id,              id,        "s.id");
        assertEq(s.caller,          caller,    "s.caller");
        assertEq(s.provider,        provider,  "s.provider");
        assertEq(s.treasury,        treasury,  "s.treasury");
        assertEq(s.amount,          AMOUNT,    "s.amount");
        assertEq(s.treasurySplitBps, SPLIT_BPS, "s.treasurySplitBps");
        assertEq(s.maxLatencyMs,    MAX_LAT,   "s.maxLatencyMs");
        assertEq(s.actualLatencyMs, 0,         "s.actualLatencyMs starts at 0");
        assertEq(s.deadline,        tsBefore + TIMEOUT, "s.deadline");
        assertEq(uint8(s.status),   uint8(BreachSLA.Status.ACTIVE), "status ACTIVE");
    }

    function test_CreateSLA_EmitsSLACreated() public {
        uint256 expectedDeadline = block.timestamp + TIMEOUT;

        vm.expectEmit(true, true, true, true, address(sla));
        emit BreachSLA.SLACreated(
            1,
            caller,
            provider,
            treasury,
            AMOUNT,
            MAX_LAT,
            expectedDeadline,
            ENDPOINT
        );

        vm.prank(caller);
        sla.createSLA{value: AMOUNT}(
            provider,
            treasury,
            SPLIT_BPS,
            MAX_LAT,
            TIMEOUT,
            ENDPOINT
        );
    }

    function test_CreateSLA_ZeroValue_RevertInvalidAmount() public {
        vm.prank(caller);
        vm.expectRevert(BreachSLA.InvalidAmount.selector);
        sla.createSLA{value: 0}(provider, treasury, SPLIT_BPS, MAX_LAT, TIMEOUT, ENDPOINT);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. Passing SLA — exact 85/15 USDC balance splits
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ResolveSLA_Settled_CorrectSplit() public {
        uint256 id = _createSLA();

        // resolve with latency within SLA (340 ms < 1200 ms)
        vm.prank(caller);
        sla.resolveSLA(id, 340, true, bytes32(0));

        BreachSLA.SLAContract memory s = sla.getSLA(id);
        assertEq(uint8(s.status), uint8(BreachSLA.Status.SETTLED), "status SETTLED");

        assertEq(sla.pendingWithdrawals(provider), PROVIDER_AMT,  "pendingWithdrawals[provider]");
        assertEq(sla.pendingWithdrawals(treasury), TREASURY_AMT,  "pendingWithdrawals[treasury]");
    }

    function test_ResolveSLA_Settled_EmitsSLASettled() public {
        uint256 id = _createSLA();

        vm.expectEmit(true, true, true, true, address(sla));
        emit BreachSLA.SLASettled(
            id,
            provider,
            treasury,
            PROVIDER_AMT,
            TREASURY_AMT,
            340,
            bytes32(0)
        );

        vm.prank(caller);
        sla.resolveSLA(id, 340, true, bytes32(0));
    }

    function test_ResolveSLA_ProviderWithdraws_CorrectBalance() public {
        uint256 id = _createSLA();

        vm.prank(caller);
        sla.resolveSLA(id, 340, true, bytes32(0));

        uint256 balBefore = provider.balance;
        vm.prank(provider);
        sla.withdraw();

        assertEq(provider.balance - balBefore, PROVIDER_AMT, "provider received 85%");
        assertEq(sla.pendingWithdrawals(provider), 0, "provider pending cleared");
    }

    function test_ResolveSLA_TreasuryWithdraws_CorrectBalance() public {
        uint256 id = _createSLA();

        vm.prank(caller);
        sla.resolveSLA(id, 340, true, bytes32(0));

        uint256 balBefore = treasury.balance;
        vm.prank(treasury);
        sla.withdraw();

        assertEq(treasury.balance - balBefore, TREASURY_AMT, "treasury received 15%");
        assertEq(sla.pendingWithdrawals(treasury), 0, "treasury pending cleared");
    }

    function test_ResolveSLA_Settled_WithdrawEmitsWithdrawn() public {
        uint256 id = _createSLA();
        vm.prank(caller);
        sla.resolveSLA(id, 340, true, bytes32(0));

        vm.expectEmit(true, false, false, true, address(sla));
        emit BreachSLA.Withdrawn(provider, PROVIDER_AMT);
        vm.prank(provider);
        sla.withdraw();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. Breached SLA (high latency) — 100% automatic USDC refund
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ResolveSLA_HighLatency_BreachedRefunded() public {
        uint256 id = _createSLA();

        // 2850 ms > 1200 ms max  → breach
        vm.prank(caller);
        sla.resolveSLA(id, 2850, true, bytes32(0));

        BreachSLA.SLAContract memory s = sla.getSLA(id);
        assertEq(uint8(s.status), uint8(BreachSLA.Status.BREACHED_REFUNDED), "status BREACHED_REFUNDED");
        assertEq(sla.pendingWithdrawals(caller), AMOUNT, "full refund pending");
    }

    function test_ResolveSLA_HighLatency_CallerWithdraws_BalanceRestored() public {
        uint256 id = _createSLA();

        vm.prank(caller);
        sla.resolveSLA(id, 2850, true, bytes32(0));

        uint256 balBefore = caller.balance;
        vm.prank(caller);
        sla.withdraw();

        assertEq(caller.balance - balBefore, AMOUNT, "caller balance restored");
        assertEq(sla.pendingWithdrawals(caller), 0, "pending cleared");
    }

    function test_ResolveSLA_HighLatency_EmitsSLABreached() public {
        uint256 id = _createSLA();

        vm.expectEmit(true, true, false, true, address(sla));
        emit BreachSLA.SLABreached(id, caller, AMOUNT, 2850, "sla_breached");

        vm.prank(caller);
        sla.resolveSLA(id, 2850, true, bytes32(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. Breached SLA (invalid schema) — 100% refund
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ResolveSLA_InvalidSchema_BreachedRefunded() public {
        uint256 id = _createSLA();

        vm.prank(caller);
        sla.resolveSLA(id, 340, false, bytes32(0));   // validSchema = false

        BreachSLA.SLAContract memory s = sla.getSLA(id);
        assertEq(uint8(s.status), uint8(BreachSLA.Status.BREACHED_REFUNDED), "status BREACHED_REFUNDED");
        assertEq(sla.pendingWithdrawals(caller), AMOUNT, "full refund pending");
    }

    function test_ResolveSLA_InvalidSchema_EmitsSLABreachedSchemaInvalid() public {
        uint256 id = _createSLA();

        vm.expectEmit(true, true, false, true, address(sla));
        emit BreachSLA.SLABreached(id, caller, AMOUNT, 340, "schema_invalid");

        vm.prank(caller);
        sla.resolveSLA(id, 340, false, bytes32(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. Expired deadline refund — claimTimeoutRefund
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ClaimTimeoutRefund_AfterDeadline_BreachedRefunded() public {
        uint256 id = _createSLA();

        // warp past the deadline
        skip(TIMEOUT + 1);

        vm.prank(caller);
        sla.claimTimeoutRefund(id);

        BreachSLA.SLAContract memory s = sla.getSLA(id);
        assertEq(uint8(s.status), uint8(BreachSLA.Status.BREACHED_REFUNDED), "status BREACHED_REFUNDED");
        assertEq(sla.pendingWithdrawals(caller), AMOUNT, "full refund pending");
    }

    function test_ClaimTimeoutRefund_AfterDeadline_EmitsSLABreached() public {
        uint256 id = _createSLA();
        skip(TIMEOUT + 1);

        vm.expectEmit(true, true, false, true, address(sla));
        emit BreachSLA.SLABreached(id, caller, AMOUNT, 0, "timeout_claimed");

        vm.prank(caller);
        sla.claimTimeoutRefund(id);
    }

    function test_ClaimTimeoutRefund_WithdrawRestoresBalance() public {
        uint256 id = _createSLA();
        skip(TIMEOUT + 1);

        vm.prank(caller);
        sla.claimTimeoutRefund(id);

        uint256 balBefore = caller.balance;
        vm.prank(caller);
        sla.withdraw();

        assertEq(caller.balance - balBefore, AMOUNT, "caller balance restored after timeout");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. claimTimeoutRefund fails before deadline
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ClaimTimeoutRefund_BeforeDeadline_RevertDeadlineNotExpired() public {
        uint256 id = _createSLA();

        // Do NOT warp — still within the timeout window
        vm.prank(caller);
        vm.expectRevert(BreachSLA.DeadlineNotExpired.selector);
        sla.claimTimeoutRefund(id);
    }

    function test_ClaimTimeoutRefund_AtDeadline_RevertDeadlineNotExpired() public {
        uint256 id = _createSLA();
        BreachSLA.SLAContract memory s = sla.getSLA(id);

        // warp exactly to deadline (block.timestamp == deadline → still not expired)
        vm.warp(s.deadline);

        vm.prank(caller);
        vm.expectRevert(BreachSLA.DeadlineNotExpired.selector);
        sla.claimTimeoutRefund(id);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. Only caller/provider can resolve — NotAuthorized
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ResolveSLA_Stranger_RevertNotAuthorized() public {
        uint256 id = _createSLA();

        vm.prank(stranger);
        vm.expectRevert(BreachSLA.NotAuthorized.selector);
        sla.resolveSLA(id, 340, true, bytes32(0));
    }

    function test_ClaimTimeoutRefund_Stranger_RevertNotAuthorized() public {
        uint256 id = _createSLA();
        skip(TIMEOUT + 1);

        vm.prank(stranger);
        vm.expectRevert(BreachSLA.NotAuthorized.selector);
        sla.claimTimeoutRefund(id);
    }

    /// Provider IS also an authorized resolver.
    function test_ResolveSLA_ProviderCanResolve() public {
        uint256 id = _createSLA();

        vm.prank(provider);
        sla.resolveSLA(id, 340, true, bytes32(0));  // should not revert

        assertEq(uint8(sla.getSLA(id).status), uint8(BreachSLA.Status.SETTLED));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. Cannot resolve already-settled SLA — SLANotActive
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ResolveSLA_AlreadySettled_RevertSLANotActive() public {
        uint256 id = _createSLA();

        vm.prank(caller);
        sla.resolveSLA(id, 340, true, bytes32(0));   // first settle

        vm.prank(caller);
        vm.expectRevert(BreachSLA.SLANotActive.selector);
        sla.resolveSLA(id, 340, true, bytes32(0));   // second call → revert
    }

    function test_ResolveSLA_AlreadyBreached_RevertSLANotActive() public {
        uint256 id = _createSLA();

        vm.prank(caller);
        sla.resolveSLA(id, 2850, true, bytes32(0));   // breach

        vm.prank(caller);
        vm.expectRevert(BreachSLA.SLANotActive.selector);
        sla.resolveSLA(id, 2850, true, bytes32(0));   // attempt again
    }

    function test_ClaimTimeoutRefund_AfterAlreadyResolved_RevertSLANotActive() public {
        uint256 id = _createSLA();
        skip(TIMEOUT + 1);

        vm.prank(caller);
        sla.claimTimeoutRefund(id);                   // first claim

        vm.prank(caller);
        vm.expectRevert(BreachSLA.SLANotActive.selector);
        sla.claimTimeoutRefund(id);                   // second claim
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. createSLA with zero value reverts (InvalidAmount)   — covered above,
    //    but re-stated explicitly as spec item 9.
    // ═══════════════════════════════════════════════════════════════════════════

    function test_CreateSLA_ZeroMaxLatency_RevertInvalidAmount() public {
        vm.prank(caller);
        vm.expectRevert(BreachSLA.InvalidAmount.selector);
        sla.createSLA{value: AMOUNT}(provider, treasury, SPLIT_BPS, 0, TIMEOUT, ENDPOINT);
    }

    function test_CreateSLA_InvalidProvider_RevertInvalidProvider() public {
        vm.prank(caller);
        vm.expectRevert(BreachSLA.InvalidProvider.selector);
        sla.createSLA{value: AMOUNT}(address(0), treasury, SPLIT_BPS, MAX_LAT, TIMEOUT, ENDPOINT);
    }

    function test_CreateSLA_InvalidTreasury_RevertInvalidTreasury() public {
        vm.prank(caller);
        vm.expectRevert(BreachSLA.InvalidTreasury.selector);
        sla.createSLA{value: AMOUNT}(provider, address(0), SPLIT_BPS, MAX_LAT, TIMEOUT, ENDPOINT);
    }

    function test_CreateSLA_ExcessiveSplit_RevertInvalidSplitBps() public {
        vm.prank(caller);
        vm.expectRevert(BreachSLA.InvalidSplitBps.selector);
        sla.createSLA{value: AMOUNT}(provider, treasury, 5001, MAX_LAT, TIMEOUT, ENDPOINT);
    }

    function test_CreateSLA_ZeroTimeout_RevertInvalidDeadline() public {
        vm.prank(caller);
        vm.expectRevert(BreachSLA.InvalidDeadline.selector);
        sla.createSLA{value: AMOUNT}(provider, treasury, SPLIT_BPS, MAX_LAT, 0, ENDPOINT);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. Stats tracking — 2 settled + 1 breached
    // ═══════════════════════════════════════════════════════════════════════════

    function test_GetStats_TwoSettledOneBreach() public {
        // SLA #1 — settled, latency 340 ms
        _createSLA();
        vm.prank(caller);
        sla.resolveSLA(1, 340, true, bytes32(0));

        // SLA #2 — settled, latency 660 ms
        vm.prank(caller);
        sla.createSLA{value: AMOUNT}(provider, treasury, SPLIT_BPS, MAX_LAT, TIMEOUT, ENDPOINT);
        vm.prank(caller);
        sla.resolveSLA(2, 660, true, bytes32(0));

        // SLA #3 — breached (high latency)
        vm.prank(caller);
        sla.createSLA{value: AMOUNT}(provider, treasury, SPLIT_BPS, MAX_LAT, TIMEOUT, ENDPOINT);
        vm.prank(caller);
        sla.resolveSLA(3, 2850, true, bytes32(0));

        (
            uint256 _totalVolume,
            uint256 _totalSettled,
            uint256 _totalRefunded,
            uint256 _settledCount,
            uint256 _avgLatencyMs,
            uint256 _successRate
        ) = sla.getStats();

        assertEq(_totalVolume,    3 * AMOUNT,       "totalVolume = 3 * AMOUNT");
        assertEq(_totalSettled,   2 * AMOUNT,       "totalSettled = 2 * AMOUNT");
        assertEq(_totalRefunded,  AMOUNT,           "totalRefunded = 1 * AMOUNT");
        assertEq(_settledCount,   2,                "settledCount = 2");
        // avgLatency = (340 + 660) / 2 = 500
        assertEq(_avgLatencyMs,   500,              "avgLatencyMs = 500");
        // successRate = (2 settled / 3 total) * 10000 = 6666 (integer division)
        assertEq(_successRate,    6666,             "successRate = 6666 bps");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Additional: withdraw() reverts with InvalidAmount when nothing pending
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_NothingPending_RevertInvalidAmount() public {
        vm.prank(stranger);
        vm.expectRevert(BreachSLA.InvalidAmount.selector);
        sla.withdraw();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Additional: resolveSLA via provider resolves after deadline also refunds
    // (deadline-expired path inside resolveSLA)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ResolveSLA_AfterDeadline_RefundsCallerViaResolvePath() public {
        uint256 id = _createSLA();
        skip(TIMEOUT + 1);

        // Provider calls resolveSLA after deadline — triggers deadline-expired branch
        vm.prank(provider);
        sla.resolveSLA(id, 340, true, bytes32(0));

        BreachSLA.SLAContract memory s = sla.getSLA(id);
        assertEq(uint8(s.status), uint8(BreachSLA.Status.BREACHED_REFUNDED), "status BREACHED_REFUNDED");
        assertEq(sla.pendingWithdrawals(caller), AMOUNT, "full refund pending for caller");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Fuzz: createSLA — split math is always exact
    // ═══════════════════════════════════════════════════════════════════════════

    function testFuzz_ResolveSLA_SplitSumsToAmount(
        uint256 amount,
        uint256 splitBps
    ) public {
        // Bound to valid ranges
        amount   = bound(amount, 1, 10 ether);
        splitBps = bound(splitBps, 0, 5000);

        vm.deal(caller, amount);
        vm.prank(caller);
        uint256 id = sla.createSLA{value: amount}(
            provider,
            treasury,
            splitBps,
            MAX_LAT,
            TIMEOUT,
            ENDPOINT
        );

        vm.prank(caller);
        sla.resolveSLA(id, 100, true, bytes32(0));   // within latency → settle

        uint256 provAmt  = sla.pendingWithdrawals(provider);
        uint256 trAmt    = sla.pendingWithdrawals(treasury);

        // PROPERTY: provider + treasury allocations always sum to the original amount
        assertEq(provAmt + trAmt, amount, "split must sum to amount");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Invariant: contract balance >= sum of pending withdrawals
    // ═══════════════════════════════════════════════════════════════════════════

    // Handler is defined at the bottom of the file.
    BreachSLAHandler internal handler;

    function setUp_Invariant() internal {
        // Called from the invariant test's setUp via override of setUp().
        // NOTE: forge runs setUp() before EVERY test including invariants.
    }

    function invariant_ContractBalanceCoversWithdrawals() public view {
        // This guard fires only when the handler is set up (invariant tests).
        if (address(handler) == address(0)) return;

        uint256 contractBalance  = address(sla).balance;
        uint256 claimableTotal   = handler.ghostWithdrawable();

        assertGe(contractBalance, claimableTotal, "contract balance must cover all pending withdrawals");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Invariant handler
// ──────────────────────────────────────────────────────────────────────────────

contract BreachSLAInvariantTest is Test {
    BreachSLA         internal slaContract;
    BreachSLAHandler  internal handler;

    function setUp() public {
        slaContract = new BreachSLA();
        handler     = new BreachSLAHandler(slaContract);
        targetContract(address(handler));
    }

    /// PROPERTY: the contract's native balance is always >= all withdrawable amounts combined.
    function invariant_BalanceCoversWithdrawals() public view {
        assertGe(
            address(slaContract).balance,
            handler.ghostWithdrawable(),
            "contract balance must cover all pending withdrawals"
        );
    }
}

contract BreachSLAHandler is Test {
    BreachSLA internal slaContract;

    address internal caller_h   = makeAddr("h_caller");
    address internal provider_h = makeAddr("h_provider");
    address internal treasury_h = makeAddr("h_treasury");

    uint256 public ghostWithdrawable;

    constructor(BreachSLA _sla) {
        slaContract = _sla;
        vm.deal(caller_h,   1000 ether);
        vm.deal(provider_h, 10 ether);
        vm.deal(treasury_h, 10 ether);
    }

    function createAndSettle(uint256 amount, uint256 splitBps, uint256 latencyMs) external {
        amount    = bound(amount,    1,    10 ether);
        splitBps  = bound(splitBps,  0,    5000);
        latencyMs = bound(latencyMs, 1,    1200);

        if (caller_h.balance < amount) return;

        vm.prank(caller_h);
        uint256 id = slaContract.createSLA{value: amount}(
            provider_h,
            treasury_h,
            splitBps,
            1200,
            3600,
            "ep"
        );

        vm.prank(caller_h);
        slaContract.resolveSLA(id, latencyMs, true, bytes32(0));

        // The full amount is now pending for provider+treasury
        ghostWithdrawable += amount;
    }

    function createAndBreach(uint256 amount) external {
        amount = bound(amount, 1, 10 ether);
        if (caller_h.balance < amount) return;

        vm.prank(caller_h);
        uint256 id = slaContract.createSLA{value: amount}(
            provider_h,
            treasury_h,
            1500,
            1200,
            3600,
            "ep"
        );

        vm.prank(caller_h);
        slaContract.resolveSLA(id, 9999, true, bytes32(0)); // latency > max → breach

        ghostWithdrawable += amount;
    }

    function withdraw(bool asProvider) external {
        address who = asProvider ? provider_h : treasury_h;
        uint256 pending = slaContract.pendingWithdrawals(who);
        if (pending == 0) return;

        ghostWithdrawable -= pending;

        vm.prank(who);
        slaContract.withdraw();
    }

    function withdrawAsCaller() external {
        uint256 pending = slaContract.pendingWithdrawals(caller_h);
        if (pending == 0) return;

        ghostWithdrawable -= pending;

        vm.prank(caller_h);
        slaContract.withdraw();
    }
}
