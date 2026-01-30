// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IBurnableERC20
 * @notice Interface for ERC20 tokens that support burning (e.g. from bridge balance).
 */
interface IBurnableERC20 is IERC20 {
    /**
     * @notice Burns tokens from the caller (msg.sender).
     * @param amount Amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}

/**
 * @title EthereumBridge
 * @author Bridge Team
 * @notice Ethereum-side bridge contract for Burn-and-Mint: receives resource tokens, burns them, and emits Bridged for off-chain relayer.
 * @dev Secured with Ownable, Pausable, ReentrancyGuard. Resource tokens (Wood, Coal, Water, Gas) must be burnable.
 */
contract EthereumBridge is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Whitelist of supported resource tokens (e.g. Wood, Coal, Water, Gas).
    mapping(address => bool) public supportedTokens;

    /// @notice Authorized relayer address (for reverse flow / claiming; not used in burn flow).
    address public relayer;

    /// @notice Address that receives native ETH bridge fees (if any).
    address public feeReceiver;

    /// @notice Required bridge fee in wei (0 = no fee). Set by owner.
    uint256 public bridgeFeeWei;

    /// @dev Unique identifier for the source tx; emitted for off-chain indexing.
    event Bridged(
        bytes32 indexed sourceTxHash,
        address indexed sourceAddress,
        string destinationAddress,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    error InvalidAmount();
    error TokenNotSupported();
    error InsufficientFee();
    error InvalidDestination();
    error ZeroAddress();

    /**
     * @notice Initializes the bridge with an initial owner.
     * @param initialOwner Address that will be the contract owner (admin).
     */
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    /**
     * @notice Bridges tokens to Solana: pulls tokens from sender, burns them, and emits Bridged.
     * @param _token Supported ERC20 token address (must be burnable).
     * @param _amount Amount of tokens to bridge (must be > 0).
     * @param _destinationAddress Solana destination address (string format).
     */
    function bridge(
        address _token,
        uint256 _amount,
        string calldata _destinationAddress
    ) external payable nonReentrant whenNotPaused {
        // --- Checks ---
        if (_amount == 0) revert InvalidAmount();
        if (!supportedTokens[_token]) revert TokenNotSupported();
        if (bytes(_destinationAddress).length == 0) revert InvalidDestination();
        if (bridgeFeeWei > 0 && msg.value < bridgeFeeWei) revert InsufficientFee();

        // --- Interactions (Checks-Effects-Interactions: effects are only the event below) ---
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        IBurnableERC20(_token).burn(_amount);

        // --- Forward fee to fee receiver ---
        if (bridgeFeeWei > 0 && feeReceiver != address(0)) {
            (bool sent, ) = feeReceiver.call{ value: bridgeFeeWei }("");
            require(sent, "EthereumBridge: fee transfer failed");
        }

        // --- Event (off-chain API) ---
        bytes32 sourceTxHash = keccak256(
            abi.encodePacked(
                block.chainid,
                block.number,
                msg.sender,
                _token,
                _amount,
                block.timestamp
            )
        );
        emit Bridged(
            sourceTxHash,
            msg.sender,
            _destinationAddress,
            _token,
            _amount,
            block.timestamp
        );
    }

    // ---------- Admin (onlyOwner) ----------

    /**
     * @notice Pauses or unpauses the bridge. When paused, bridge() reverts.
     * @param _state true = pause, false = unpause.
     */
    function setPaused(bool _state) external onlyOwner {
        if (_state) {
            _pause();
        } else {
            _unpause();
        }
    }

    /**
     * @notice Adds a token to the supported tokens whitelist.
     * @param _token Token contract address (must implement burn).
     */
    function addSupportedToken(address _token) external onlyOwner {
        if (_token == address(0)) revert ZeroAddress();
        supportedTokens[_token] = true;
    }

    /**
     * @notice Removes a token from the supported tokens whitelist.
     * @param _token Token contract address.
     */
    function removeSupportedToken(address _token) external onlyOwner {
        supportedTokens[_token] = false;
    }

    /**
     * @notice Sets the address that receives native ETH bridge fees.
     * @param _receiver New fee receiver address (can be zero to disable forwarding).
     */
    function setFeeReceiver(address _receiver) external onlyOwner {
        feeReceiver = _receiver;
    }

    /**
     * @notice Sets the required bridge fee in wei (0 = no fee).
     * @param _feeWei Fee in wei.
     */
    function setBridgeFeeWei(uint256 _feeWei) external onlyOwner {
        bridgeFeeWei = _feeWei;
    }

    /**
     * @notice Sets the relayer address (for reverse flow; not used in burn flow).
     * @param _relayer New relayer address.
     */
    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }
}
