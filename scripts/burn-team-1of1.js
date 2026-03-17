/**
 * Burn to Become — Team 1/1 NFT Script
 * Usage: node burn-team-1of1.js <agentName> <walletKeyPath> <imageUrl> <metadataUrl>
 * 
 * Steps:
 * 1. Mint 1/1 NFT to agent wallet
 * 2. Burn the NFT (signed by agent wallet)
 * 3. Mint soulbound Token-2022 (non-transferable)
 * 4. Register SATP face attestation (Memo TX)
 * 5. Update DB profile
 */

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, ComputeBudgetProgram } = require("@solana/web3.js");
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, burn, createBurnInstruction, getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID, createInitializeNonTransferableMintInstruction, createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction, getMintLen, ExtensionType, createAssociatedTokenAccountInstruction,
  createMintToInstruction, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID
} = require("@solana/spl-token");
const { createCreateMetadataAccountV3Instruction } = require("@metaplex-foundation/mpl-token-metadata");
const { createInitializeInstruction, createUpdateFieldInstruction, pack } = require("@solana/spl-token-metadata");
const fs = require("fs");
const crypto = require("crypto");

const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

async function main() {
  const [,, agentName, walletKeyPath, profileId] = process.argv;
  if (!agentName || !walletKeyPath || !profileId) {
    console.error("Usage: node burn-team-1of1.js <agentName> <walletKeyPath> <profileId>");
    process.exit(1);
  }

  // Load keys
  const deployerKey = JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/devnet-deployer.json"));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerKey));
  const agentKey = JSON.parse(fs.readFileSync(walletKeyPath));
  const agentWallet = Keypair.fromSecretKey(Uint8Array.from(agentKey));
  
  console.log("Agent:", agentName, "| Wallet:", agentWallet.publicKey.toBase58());
  console.log("Deployer:", deployer.publicKey.toBase58());

  // Check GENESIS_REGISTRY for Arweave URLs
  const Database = require("better-sqlite3");
  const path = require("path");
  const db = new Database(path.join(__dirname, "..", "data", "agentfolio.db"));
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
  if (!profile) { console.error("Profile not found:", profileId); process.exit(1); }

  // Upload image to Arweave via Irys (reuse existing if on Arweave)
  const imageFile = `/tmp/${agentName.toLowerCase()}.png`;
  if (!fs.existsSync(imageFile)) {
    console.error("Image file not found:", imageFile, "— copy it to /tmp first");
    process.exit(1);
  }

  // Use UMI/Irys for upload
  const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
  const { keypairIdentity } = require("@metaplex-foundation/umi");
  const { irysUploader } = require("@metaplex-foundation/umi-uploader-irys");
  const { createGenericFile } = require("@metaplex-foundation/umi");

  const umi = createUmi(RPC)
    .use(irysUploader({ address: "https://node2.irys.xyz" }));
  
  // Convert deployer to UMI keypair
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(deployer.secretKey);
  umi.use(keypairIdentity(umiKeypair));

  console.log("\n1. Uploading image to Arweave...");
  const imageData = fs.readFileSync(imageFile);
  const genericFile = createGenericFile(imageData, `${agentName}.png`, { contentType: "image/png" });
  const [imageUri] = await umi.uploader.upload([genericFile]);
  console.log("   Image URI:", imageUri);

  console.log("\n2. Uploading metadata to Arweave...");
  const metadata = {
    name: `${agentName} — Soulbound`,
    symbol: "BRAIN",
    description: `Official 1/1 soulbound identity for ${agentName} (brainAI team). Permanent, non-transferable, on-chain verified via SATP-FACE-v1.`,
    image: imageUri,
    attributes: [
      { trait_type: "Agent", value: agentName },
      { trait_type: "Team", value: "brainAI" },
      { trait_type: "Type", value: "Soulbound 1/1" },
      { trait_type: "Protocol", value: "SATP-FACE-v1" },
    ],
    properties: { files: [{ uri: imageUri, type: "image/png" }], category: "image" },
  };
  const metadataUri = await umi.uploader.uploadJson(metadata);
  console.log("   Metadata URI:", metadataUri);

  // === STEP 1: Mint original NFT ===
  console.log("\n3. Minting original 1/1 NFT...");
  const nftMint = Keypair.generate();
  const mint = await createMint(connection, deployer, deployer.publicKey, null, 0, nftMint);
  const ata = await getOrCreateAssociatedTokenAccount(connection, deployer, mint, agentWallet.publicKey);
  await mintTo(connection, deployer, mint, ata.address, deployer, 1);
  
  // Add Metaplex metadata
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM
  );
  const createMetaIx = createCreateMetadataAccountV3Instruction(
    { metadata: metadataPDA, mint: mint, mintAuthority: deployer.publicKey, payer: deployer.publicKey, updateAuthority: deployer.publicKey },
    { createMetadataAccountArgsV3: { data: { name: `${agentName} 1/1`, symbol: "BRAIN", uri: metadataUri, sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null }, isMutable: false, collectionDetails: null } }
  );
  const metaTx = new Transaction().add(createMetaIx);
  await sendAndConfirmTransaction(connection, metaTx, [deployer]);
  console.log("   NFT Mint:", mint.toBase58());
  console.log("   Token Account:", ata.address.toBase58());

  // === STEP 2: Burn the NFT ===
  console.log("\n4. Burning NFT...");
  const burnIx = createBurnInstruction(ata.address, mint, agentWallet.publicKey, 1);
  const burnTx = new Transaction().add(burnIx);
  const burnSig = await sendAndConfirmTransaction(connection, burnTx, [deployer, agentWallet]);
  console.log("   Burn TX:", burnSig);

  // === STEP 3: Mint soulbound Token-2022 ===
  console.log("\n5. Minting soulbound Token-2022...");
  const soulboundMint = Keypair.generate();
  const mintLen = getMintLen([ExtensionType.NonTransferable, ExtensionType.MetadataPointer]);
  const metadataContent = {
    mint: soulboundMint.publicKey,
    name: `${agentName} — Soulbound`,
    symbol: "BRAIN",
    uri: metadataUri,
    additionalMetadata: [
      ["burnTx", burnSig],
      ["originalMint", mint.toBase58()],
      ["agent", agentName],
      ["protocol", "SATP-FACE-v1"],
    ],
  };
  const metadataLen = pack(metadataContent).length;
  const fullSize = mintLen + metadataLen + 256;
  const lamports = await connection.getMinimumBalanceForRentExemption(fullSize);

  const soulTx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: deployer.publicKey, newAccountPubkey: soulboundMint.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeNonTransferableMintInstruction(soulboundMint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMetadataPointerInstruction(soulboundMint.publicKey, deployer.publicKey, soulboundMint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(soulboundMint.publicKey, 0, deployer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, mint: soulboundMint.publicKey, metadata: soulboundMint.publicKey, name: metadataContent.name, symbol: metadataContent.symbol, uri: metadataContent.uri, mintAuthority: deployer.publicKey, updateAuthority: deployer.publicKey }),
  );
  for (const [key, value] of metadataContent.additionalMetadata) {
    soulTx.add(createUpdateFieldInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: soulboundMint.publicKey, updateAuthority: deployer.publicKey, field: key, value }));
  }
  
  // Create ATA for Token-2022
  const soulAta = getAssociatedTokenAddressSync(soulboundMint.publicKey, agentWallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  soulTx.add(
    createAssociatedTokenAccountInstruction(deployer.publicKey, soulAta, agentWallet.publicKey, soulboundMint.publicKey, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(soulboundMint.publicKey, soulAta, deployer.publicKey, 1, [], TOKEN_2022_PROGRAM_ID),
  );
  const soulSig = await sendAndConfirmTransaction(connection, soulTx, [deployer, soulboundMint]);
  console.log("   Soulbound Mint:", soulboundMint.publicKey.toBase58());
  console.log("   Soulbound TX:", soulSig);

  // === STEP 4: SATP Face Attestation ===
  console.log("\n6. Registering SATP face attestation...");
  const attestation = JSON.stringify({
    protocol: "SATP-FACE-v1",
    agent: profileId,
    wallet: agentWallet.publicKey.toBase58(),
    soulboundMint: soulboundMint.publicKey.toBase58(),
    burnTx: burnSig,
    originalMint: mint.toBase58(),
    image: imageUri,
    metadata: metadataUri,
    attestedAt: new Date().toISOString(),
    attestedBy: deployer.publicKey.toBase58(),
  });
  const memoIx = { programId: MEMO_PROGRAM, keys: [{ pubkey: deployer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(attestation) };
  const memoTx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }), memoIx);
  const memoSig = await sendAndConfirmTransaction(connection, memoTx, [deployer]);
  console.log("   Attestation TX:", memoSig);

  // === STEP 5: Update DB ===
  console.log("\n7. Updating database...");
  const nftAvatar = JSON.stringify({
    chain: "solana", wallet: agentWallet.publicKey.toBase58(), identifier: mint.toBase58(),
    name: `${agentName} — Soulbound`, image: imageUri, arweaveUrl: imageUri,
    verifiedAt: new Date().toISOString(), verifiedOnChain: true, permanent: true,
    burnTxSignature: burnSig, soulboundMint: soulboundMint.publicKey.toBase58(),
    attestationTx: memoSig, metadataUri: metadataUri, burnedAt: new Date().toISOString(),
  });
  db.prepare("UPDATE profiles SET nft_avatar = ?, avatar = ?, updated_at = ? WHERE id = ?").run(nftAvatar, imageUri, new Date().toISOString(), profileId);
  db.close();
  console.log("   Profile updated ✅");

  console.log("\n✅ BURN TO BECOME COMPLETE for", agentName);
  console.log("   Image:", imageUri);
  console.log("   Soulbound:", soulboundMint.publicKey.toBase58());
  console.log("   Attestation:", memoSig);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
