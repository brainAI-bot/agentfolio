const { SATPSDK } = require("./src/index.js");
const { Keypair, Connection } = require("@solana/web3.js");
const fs = require("fs");

async function main() {
  const rpc = "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb";
  const connection = new Connection(rpc, "confirmed");
  const sdk = new SATPSDK(connection);
  
  const secret = JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/id.json", "utf8"));
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
      
      const verTx = await sdk.buildUpdateVerification(signer.publicKey, a.id, a.level);
      verTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      verTx.feePayer = signer.publicKey;
      verTx.sign(signer);
      const verSig = await connection.sendRawTransaction(verTx.serialize());
      console.log("  Ver TX:", verSig);
      
      await new Promise(r => setTimeout(r, 1000));
      
      const repTx = await sdk.buildUpdateReputation(signer.publicKey, a.id, a.repBps);
      repTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      repTx.feePayer = signer.publicKey;
      repTx.sign(signer);
      const repSig = await connection.sendRawTransaction(repTx.serialize());
      console.log("  Rep TX:", repSig);
      
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error("  Error:", e.message);
    }
  }
}
main().catch(console.error);
