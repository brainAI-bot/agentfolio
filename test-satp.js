const { SATPSDK } = require("/home/ubuntu/agentfolio/satp-client/src");
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");

const sdk = new SATPSDK();
const deployer = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/devnet-deployer.json"))
));

console.log("Deployer:", deployer.publicKey.toBase58());

const metadata = JSON.stringify({
  platform: "agentfolio",
  profileId: "agent_braintrade",
  permanentFace: {
    soulboundMint: "TEST_MINT_ADDRESS",
    arweaveImage: "https://gateway.irys.xyz/DKDgDFAgwZVFrUEnbLXoVaxr3nELW3je3cybEad9DYMj",
    burnTx: "TEST_BURN_TX",
    permanent: true
  }
});

sdk.buildRegisterIdentity(deployer.publicKey, "brainTrade", metadata)
  .then(result => {
    console.log("Identity PDA:", result.identityPDA.toBase58());
    console.log("TX built successfully");
  })
  .catch(e => console.error("Error:", e.message));
