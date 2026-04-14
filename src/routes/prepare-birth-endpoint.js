/**
 * prepare-birth-endpoint.js
 * 
 * New endpoint: POST /api/burn-to-become/prepare-birth
 * Builds an unsigned burnToBecome TX for agents whose authority != deployer.
 * The agent signs with their wallet and submits via /api/burn-to-become/submit-birth.
 * 
 * Request body: { wallet, faceImage, faceMint, faceBurnTx }
 * Response: { transaction (base64), authority, genesisPDA }
 * 
 * To integrate: add these handlers to handleBurnToBecome in burn-to-become-public.js
 */

const { Connection, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const crypto = require('crypto');

const IDENTITY_V3 = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function getGenesisPDA(agentId) {
  const hash = crypto.createHash('sha256').update(agentId).digest();
  return PublicKey.findProgramAddressSync([Buffer.from('genesis'), hash], IDENTITY_V3);
}

/**
 * Parse authority from Genesis Record.
 * Uses DEPLOYED struct layout (no is_active between genesis_record and authority).
 */
function parseGenesisAuthority(data) {
  let o = 8; // disc
  o += 32; // agent_id_hash
  const readStr = () => { const l = data.readUInt32LE(o); o += 4; o += l; };
  readStr(); readStr(); readStr(); // name, desc, category
  const capCount = data.readUInt32LE(o); o += 4;
  for (let i = 0; i < capCount; i++) readStr();
  readStr(); readStr(); // metadataUri, faceImage
  o += 32; // faceMint
  readStr(); // faceBurnTx
  const genesisRecord = Number(data.readBigInt64LE(o)); o += 8;
  // NO is_active in deployed program
  const authority = new PublicKey(data.slice(o, o + 32));
  return { authority, isBorn: genesisRecord > 0 };
}

/**
 * Build unsigned burnToBecome TX
 */
async function buildBurnToBecomeForWallet(agentId, faceImage, faceMint, faceBurnTx) {
  const conn = new Connection(RPC_URL, 'confirmed');
  const [genesisPDA] = getGenesisPDA(agentId);
  
  const acct = await conn.getAccountInfo(genesisPDA);
  if (!acct) throw new Error('Genesis Record not found for ' + agentId);
  
  const { authority, isBorn } = parseGenesisAuthority(acct.data);
  if (isBorn) throw new Error('Agent already born');
  
  const disc = anchorDisc('burn_to_become');
  const faceImageBuf = Buffer.from(faceImage, 'utf8');
  const faceMintPk = new PublicKey(faceMint);
  const faceBurnTxBuf = Buffer.from(faceBurnTx, 'utf8');
  
  const ixData = Buffer.concat([
    disc,
    Buffer.from(new Uint32Array([faceImageBuf.length]).buffer), faceImageBuf,
    faceMintPk.toBuffer(),
    Buffer.from(new Uint32Array([faceBurnTxBuf.length]).buffer), faceBurnTxBuf,
  ]);
  
  const ix = new TransactionInstruction({
    programId: IDENTITY_V3,
    keys: [
      { pubkey: genesisPDA, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: ixData,
  });
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
  tx.add(ix);
  tx.feePayer = authority;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  
  return {
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    authority: authority.toBase58(),
    genesisPDA: genesisPDA.toBase58(),
    blockhash,
    lastValidBlockHeight,
  };
}

module.exports = { buildBurnToBecomeForWallet, parseGenesisAuthority, getGenesisPDA };
