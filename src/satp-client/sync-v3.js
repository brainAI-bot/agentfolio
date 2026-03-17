const { createSATPClient } = require("./src/index.js");
const { Keypair, Connection } = require("@solana/web3.js");
const fs = require("fs");

async function main() {
  const rpc = "https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY";
  const client = createSATPClient({ rpcUrl: rpc });
  const connection = new Connection(rpc, "confirmed");
  
  const secret = JSON.parse(fs.readFileSync("/tmp/v3-authority.json", "utf8"));
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log("Authority:", signer.publicKey.toBase58());
  
  const agents = [
    { id: "agent_brainkid", level: 3, repBps: 750000 },
    { id: "agent_brainchain", level: 1, repBps: 600000 },
    { id: "agent_braingrowth", level: 1, repBps: 600000 },
    { id: "agent_braintrade", level: 1, repBps: 550000 },
  ];
  
  for (const a of agents) {
    try {
      console.log("Updating " + a.id + ": level=" + a.level + ", rep=" + a.repBps);
      
      const { transaction: verTx } = await client.buildUpdateVerification(signer.publicKey, a.id, a.level);
      verTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      verTx.feePayer = signer.publicKey;
      verTx.sign(signer);
      const verSig = await connection.sendRawTransaction(verTx.serialize());
      console.log("  Ver TX:", verSig);
      
      await new Promise(r => setTimeout(r, 1500));
      
      const { transaction: repTx } = await client.buildUpdateReputation(signer.publicKey, a.id, a.repBps);
      repTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      repTx.feePayer = signer.publicKey;
      repTx.sign(signer);
      const repSig = await connection.sendRawTransaction(repTx.serialize());
      console.log("  Rep TX:", repSig);
      
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error("  Error:", e.message);
    }
  }
  
  // Clean up keypair
  fs.unlinkSync("/tmp/v3-authority.json");
  console.log("\nDone. Keypair cleaned up.");
}
main().catch(console.error);
