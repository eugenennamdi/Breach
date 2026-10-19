// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BreachSLA is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        ACTIVE,
        SETTLED,
        BREACHED_REFUNDED
    }

    struct SLAContract {
        uint256 id;
        address caller;
        address provider;
        address treasury;
        uint256 amount;
        uint256 treasurySplitBps;
        uint256 maxLatencyMs;
        uint256 actualLatencyMs;
        uint256 createdAt;
        uint256 deadline;
        bytes32 payloadHash;
        string endpointName;
        Status status;
    }

    mapping(uint256 => SLAContract) public slaContracts;
    mapping(address => uint256) public pendingWithdrawals;

    uint256 public slaCount;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_SPLIT_BPS = 5_000;

    uint256 public totalVolume;
    uint256 public totalSettled;
    uint256 public totalRefunded;
    uint256 public totalLatencyMs;
    uint256 public settledCount;

    event SLACreated(
        uint256 indexed id,
        address indexed caller,
        address indexed provider,
        address treasury,
        uint256 amount,
        uint256 maxLatencyMs,
        uint256 deadline,
        string endpointName
    );

    event SLASettled(
        uint256 indexed id,
        address indexed provider,
        address indexed treasury,
        uint256 providerAmount,
        uint256 treasuryAmount,
        uint256 actualLatencyMs,
        bytes32 payloadHash
    );

    event SLABreached(
        uint256 indexed id,
        address indexed caller,
        uint256 amount,
        uint256 actualLatencyMs,
        string reason
    );

    event Withdrawn(address indexed recipient, uint256 amount);

    error InvalidProvider();
    error InvalidTreasury();
    error InvalidAmount();
    error InvalidSplitBps();
    error InvalidDeadline();
    error SLANotActive();
    error NotAuthorized();
    error DeadlineNotExpired();
    error DeadlineExpired();
    error TransferFailed();

    /// @notice Create a new SLA escrow funded with native Arc gas token (USDC, 18 decimals).
    /// @param _provider Provider address that receives payout on success.
    /// @param _treasury Treasury address that receives treasury split on success.
    /// @param _treasurySplitBps Treasury split in basis points (max 5000).
    /// @param _maxLatencyMs Maximum acceptable latency in milliseconds.
    /// @param _timeoutSeconds SLA timeout in seconds from creation.
    /// @param _endpointName Human-readable endpoint identifier.
    /// @return id Newly created SLA id.
    function createSLA(
        address _provider,
        address _treasury,
        uint256 _treasurySplitBps,
        uint256 _maxLatencyMs,
        uint256 _timeoutSeconds,
        string calldata _endpointName
    ) external payable nonReentrant returns (uint256 id) {
        if (msg.value == 0) revert InvalidAmount();
        if (_provider == address(0)) revert InvalidProvider();
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_treasurySplitBps > MAX_SPLIT_BPS) revert InvalidSplitBps();
        if (_timeoutSeconds == 0) revert InvalidDeadline();
        if (_maxLatencyMs == 0) revert InvalidAmount();

        uint256 deadline = block.timestamp + _timeoutSeconds;

        id = ++slaCount;
        slaContracts[id] = SLAContract({
            id: id,
            caller: msg.sender,
            provider: _provider,
            treasury: _treasury,
            amount: msg.value,
            treasurySplitBps: _treasurySplitBps,
            maxLatencyMs: _maxLatencyMs,
            actualLatencyMs: 0,
            createdAt: block.timestamp,
            deadline: deadline,
            payloadHash: bytes32(0),
            endpointName: _endpointName,
            status: Status.ACTIVE
        });

        totalVolume += msg.value;

        emit SLACreated(
            id,
            msg.sender,
            _provider,
            _treasury,
            msg.value,
            _maxLatencyMs,
            deadline,
            _endpointName
        );
    }

    /// @notice Resolve an active SLA and settle payout or refund depending on SLA outcome.
    /// @dev Either the caller or provider may resolve; first to call wins because only ACTIVE SLAs can be resolved.
    ///      Provider calls with success proof; caller calls with breach evidence.
    /// @param _id SLA id.
    /// @param _actualLatencyMs Observed latency in milliseconds.
    /// @param _validSchema Whether payload schema validation passed.
    /// @param _payloadHash Hash of response payload.
    function resolveSLA(
        uint256 _id,
        uint256 _actualLatencyMs,
        bool _validSchema,
        bytes32 _payloadHash
    ) external nonReentrant {
        SLAContract storage sla = slaContracts[_id];

        if (sla.status != Status.ACTIVE) revert SLANotActive();
        if (msg.sender != sla.caller && msg.sender != sla.provider) revert NotAuthorized();

        sla.actualLatencyMs = _actualLatencyMs;
        sla.payloadHash = _payloadHash;

        if (block.timestamp > sla.deadline) {
            sla.status = Status.BREACHED_REFUNDED;
            totalRefunded += sla.amount;

            emit SLABreached(_id, sla.caller, sla.amount, _actualLatencyMs, "deadline_expired");
            pendingWithdrawals[sla.caller] += sla.amount;
            return;
        }

        if (_validSchema && _actualLatencyMs <= sla.maxLatencyMs) {
            sla.status = Status.SETTLED;

            uint256 treasuryAmount = (sla.amount * sla.treasurySplitBps) / BPS_DENOMINATOR;
            uint256 providerAmount = sla.amount - treasuryAmount;

            totalSettled += sla.amount;
            totalLatencyMs += _actualLatencyMs;
            settledCount += 1;

            emit SLASettled(
                _id,
                sla.provider,
                sla.treasury,
                providerAmount,
                treasuryAmount,
                _actualLatencyMs,
                _payloadHash
            );

            pendingWithdrawals[sla.provider] += providerAmount;
            pendingWithdrawals[sla.treasury] += treasuryAmount;
            return;
        }

        sla.status = Status.BREACHED_REFUNDED;
        totalRefunded += sla.amount;

        string memory reason = _validSchema ? "sla_breached" : "schema_invalid";
        emit SLABreached(_id, sla.caller, sla.amount, _actualLatencyMs, reason);
        pendingWithdrawals[sla.caller] += sla.amount;
    }

    /// @notice Claim timeout refund for an active SLA after its deadline expires.
    /// @param _id SLA id.
    function claimTimeoutRefund(uint256 _id) external nonReentrant {
        SLAContract storage sla = slaContracts[_id];

        if (sla.status != Status.ACTIVE) revert SLANotActive();
        if (msg.sender != sla.caller) revert NotAuthorized();
        if (block.timestamp <= sla.deadline) revert DeadlineNotExpired();

        sla.status = Status.BREACHED_REFUNDED;
        totalRefunded += sla.amount;

        emit SLABreached(_id, sla.caller, sla.amount, 0, "timeout_claimed");
        pendingWithdrawals[sla.caller] += sla.amount;
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert InvalidAmount();

        pendingWithdrawals[msg.sender] = 0;
        _sendNative(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Return SLA details by id.
    /// @param _id SLA id.
    /// @return SLAContract Struct containing SLA data.
    function getSLA(uint256 _id) external view returns (SLAContract memory) {
        return slaContracts[_id];
    }

    /// @notice Return all currently active SLAs.
    /// @return activeSLAs Array of active SLA records.
    function getActiveSLAs() external view returns (SLAContract[] memory activeSLAs) {
        uint256 count;
        for (uint256 i = 1; i <= slaCount; i++) {
            if (slaContracts[i].status == Status.ACTIVE) {
                count++;
            }
        }

        activeSLAs = new SLAContract[](count);
        uint256 cursor;

        for (uint256 i = 1; i <= slaCount; i++) {
            if (slaContracts[i].status == Status.ACTIVE) {
                activeSLAs[cursor] = slaContracts[i];
                cursor++;
            }
        }
    }

    /// @notice Return all SLAs ever created.
    /// @return allSLAs Array of all SLA records.
    function getAllSLAs() external view returns (SLAContract[] memory allSLAs) {
        allSLAs = new SLAContract[](slaCount);

        for (uint256 i = 1; i <= slaCount; i++) {
            allSLAs[i - 1] = slaContracts[i];
        }
    }

    /// @notice Return aggregate protocol statistics.
    /// @return _totalVolume Total volume escrowed.
    /// @return _totalSettled Total amount settled to provider/treasury.
    /// @return _totalRefunded Total amount refunded to callers.
    /// @return _settledCount Number of settled SLAs.
    /// @return _avgLatencyMs Average latency across settled SLAs.
    /// @return _successRate Settled ratio in basis points (10000 = 100%).
    function getStats()
        external
        view
        returns (
            uint256 _totalVolume,
            uint256 _totalSettled,
            uint256 _totalRefunded,
            uint256 _settledCount,
            uint256 _avgLatencyMs,
            uint256 _successRate
        )
    {
        _totalVolume = totalVolume;
        _totalSettled = totalSettled;
        _totalRefunded = totalRefunded;
        _settledCount = settledCount;
        _avgLatencyMs = settledCount > 0 ? totalLatencyMs / settledCount : 0;
        _successRate = slaCount > 0 ? (settledCount * BPS_DENOMINATOR) / slaCount : 0;
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
