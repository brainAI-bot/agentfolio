const { createSATPClient, SATPV3SDK } = require("./satp-client/src/index.js");
const { Keypair, Connection } = require("@solana/web3.js");
const fs = require("fs");

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb";
  const client = createSATPClient({ rpcUrl: rpc });
  const connection = new Connection(rpc, "confirmed");
  
  // Load deployer keypair (authority)
  const keyPath = "/home/ubuntu/agentfolio/deployer-keypair.json";
  if (!fs.existsSync(keyPath)) {
    console.log("No deployer keypair found at", keyPath);
    // Try alternative paths
    const altPaths = [
      "/home/ubuntu/.config/solana/id.json",
      "/home/ubuntu/agentfolio/src/satp-client/deployer.json",
    ];
    for (const p of altPaths) {
      if (fs.existsSync(p)) {
        console.log("Found keypair at", p);
        break;
      }
    }
    return;
  }
  
  const secret = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log("Authority:", signer.publicKey.toBase58());
  
  // Update brainKID: 5 verifications → Level 3
  const agents = [
    { id: "agent_brainkid", level: 3, repBps: 750000 },  // 5 verifications, 75%
    { id: "agent_brainforge", level: 2, repBps: 750000 },  // already at 2, keep
  ];
  
  for (const a of agents) {
    try {
      console.log(`\nUpdating ${a.id}: level=${a.level}, rep=${a.repBps}`);
      
      // Update verification level
      const { transaction: verTx } = await client.buildUpdateVerification(signer.publicKey, a.id, a.level);
      verTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      verTx.feePayer = signer.publicKey;
      verTx.sign(signer);
      const verSig = await connection.sendRawTransaction(verTx.serialize());
      console.log(`  Verification updated: ${verSig}`);
      
      // Update reputation
      const { transaction: repTx } = await client.buildUpdateReputation(signer.publicKey, a.id, a.repBps);
      repTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      repTx.feePayer = signer.publicKey;
      repTx.sign(signer);
      const repSig = await connection.sendRawTransaction(repTx.serialize());
      console.log(`  Reputation updated: ${repSig}`);
    } catch (e) {
      console.error(`  Error updating ${a.id}:`, e.message);
    }
  }
}

main().catch(console.error);
