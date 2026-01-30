const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const EthereumBridge = await hre.ethers.getContractFactory("EthereumBridge");
  const bridge = await EthereumBridge.deploy(deployer.address);
  await bridge.waitForDeployment();

  const address = await bridge.getAddress();
  console.log("EthereumBridge deployed to:", address);

  // Optional: set fee receiver from env
  const feeReceiver = process.env.FEE_RECEIVER;
  if (feeReceiver) {
    await bridge.setFeeReceiver(feeReceiver);
    console.log("Fee receiver set to:", feeReceiver);
  }

  return address;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
