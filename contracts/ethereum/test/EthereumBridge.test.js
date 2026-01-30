const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EthereumBridge", function () {
  let bridge;
  let woodToken;
  let owner;
  let user;
  let feeReceiverAccount;
  const BRIDGE_AMOUNT = ethers.parseEther("100");
  const BRIDGE_FEE_WEI = ethers.parseEther("0.001");
  const DESTINATION_SOLANA = "SolanaWalletAddress123";

  beforeEach(async function () {
    [owner, user, feeReceiverAccount] = await ethers.getSigners();

    const EthereumBridge = await ethers.getContractFactory("EthereumBridge");
    bridge = await EthereumBridge.deploy(owner.address);
    await bridge.waitForDeployment();

    const MockBurnableERC20 = await ethers.getContractFactory("MockBurnableERC20");
    woodToken = await MockBurnableERC20.deploy("Wood", "WOOD");
    await woodToken.waitForDeployment();

    await woodToken.mint(user.address, BRIDGE_AMOUNT);
    await bridge.connect(owner).addSupportedToken(await woodToken.getAddress());
  });

  describe("TC-001: Happy path - bridge 100 Wood to valid Solana address", function () {
    it("decreases user balance by 100, emits Bridged with correct params", async function () {
      const tokenAddress = await woodToken.getAddress();
      await woodToken.connect(user).approve(await bridge.getAddress(), BRIDGE_AMOUNT);

      await expect(
        bridge.connect(user).bridge(tokenAddress, BRIDGE_AMOUNT, DESTINATION_SOLANA)
      )
        .to.emit(bridge, "Bridged")
        .withArgs(
          (sourceTxHash) => expect(sourceTxHash).to.match(/^0x[a-fA-F0-9]{64}$/),
          user.address,
          DESTINATION_SOLANA,
          tokenAddress,
          BRIDGE_AMOUNT,
          (timestamp) => expect(Number(timestamp)).to.be.gte(0)
        );

      expect(await woodToken.balanceOf(user.address)).to.equal(0);
    });
  });

  describe("TC-002: Validation - bridge amount 0", function () {
    it("reverts with InvalidAmount", async function () {
      const tokenAddress = await woodToken.getAddress();
      await woodToken.connect(user).approve(await bridge.getAddress(), BRIDGE_AMOUNT);

      await expect(
        bridge.connect(user).bridge(tokenAddress, 0, DESTINATION_SOLANA)
      ).to.be.revertedWithCustomError(bridge, "InvalidAmount");
    });
  });

  describe("TC-003: Validation - unsupported token", function () {
    it("reverts with TokenNotSupported", async function () {
      const unsupportedToken = await (await ethers.getContractFactory("MockBurnableERC20"))
        .deploy("Other", "OTH");
      await unsupportedToken.waitForDeployment();
      await unsupportedToken.mint(user.address, BRIDGE_AMOUNT);
      await unsupportedToken.connect(user).approve(await bridge.getAddress(), BRIDGE_AMOUNT);

      await expect(
        bridge.connect(user).bridge(await unsupportedToken.getAddress(), BRIDGE_AMOUNT, DESTINATION_SOLANA)
      ).to.be.revertedWithCustomError(bridge, "TokenNotSupported");
    });
  });

  describe("TC-004: Pause - user bridges when paused", function () {
    it("reverts with Pausable: paused", async function () {
      await bridge.connect(owner).setPaused(true);
      const tokenAddress = await woodToken.getAddress();
      await woodToken.connect(user).approve(await bridge.getAddress(), BRIDGE_AMOUNT);

      await expect(
        bridge.connect(user).bridge(tokenAddress, BRIDGE_AMOUNT, DESTINATION_SOLANA)
      ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
    });
  });

  describe("TC-005: Access control - non-admin unpause / add token", function () {
    it("reverts when non-owner calls setPaused(false)", async function () {
      await bridge.connect(owner).setPaused(true);
      await expect(bridge.connect(user).setPaused(false)).to.be.revertedWithCustomError(
        bridge,
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts when non-owner calls addSupportedToken", async function () {
      const otherToken = (await ethers.getContractFactory("MockBurnableERC20")).getDeployTransaction(
        "Other",
        "OTH"
      );
      const otherAddress = "0x0000000000000000000000000000000000000001";
      await expect(bridge.connect(user).addSupportedToken(otherAddress)).to.be.revertedWithCustomError(
        bridge,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("TC-006: Fee - user bridges without required ETH fee", function () {
    it("reverts with InsufficientFee when fee is set and msg.value < fee", async function () {
      await bridge.connect(owner).setBridgeFeeWei(BRIDGE_FEE_WEI);
      await bridge.connect(owner).setFeeReceiver(feeReceiverAccount.address);

      const tokenAddress = await woodToken.getAddress();
      await woodToken.connect(user).approve(await bridge.getAddress(), BRIDGE_AMOUNT);

      await expect(
        bridge.connect(user).bridge(tokenAddress, BRIDGE_AMOUNT, DESTINATION_SOLANA, {
          value: BRIDGE_FEE_WEI - 1n,
        })
      ).to.be.revertedWithCustomError(bridge, "InsufficientFee");
    });

    it("succeeds when msg.value >= fee", async function () {
      await bridge.connect(owner).setBridgeFeeWei(BRIDGE_FEE_WEI);
      await bridge.connect(owner).setFeeReceiver(feeReceiverAccount.address);

      const tokenAddress = await woodToken.getAddress();
      await woodToken.connect(user).approve(await bridge.getAddress(), BRIDGE_AMOUNT);

      const balanceBefore = await ethers.provider.getBalance(feeReceiverAccount.address);
      await bridge.connect(user).bridge(tokenAddress, BRIDGE_AMOUNT, DESTINATION_SOLANA, {
        value: BRIDGE_FEE_WEI,
      });
      const balanceAfter = await ethers.provider.getBalance(feeReceiverAccount.address);
      expect(balanceAfter - balanceBefore).to.equal(BRIDGE_FEE_WEI);
    });
  });
});
