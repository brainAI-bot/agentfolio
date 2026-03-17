/**
 * Core Candy Machine — Devnet Test
 * Following QuickNode guide exactly
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  create,
  addConfigLines,
  fetchCandyMachine,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { createCollectionV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  some,
  sol,
  transactionBuilder,
} from '@metaplex-foundation/umi';
import fs from 'fs';

const RPC = 'https://api.devnet.solana.com';

async function main() {
  const umi = createUmi(RPC).use(mplCoreCandyMachine());

  // Load or generate keypair
  let keypair;
  const keyPath = process.env.HOME + '/.config/solana/devnet-deployer.json';
  if (fs.existsSync(keyPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  } else {
    keypair = generateSigner(umi);
  }
  umi.use(keypairIdentity(keypair));

  const collectionMint = generateSigner(umi);
  const candyMachine = generateSigner(umi);

  const options = {
    send: { skipPreflight: true },
    confirm: { commitment: 'processed' },
  };

  console.log('Keypair:', keypair.publicKey.toString());
  console.log('Collection:', collectionMint.publicKey.toString());
  console.log('Candy Machine:', candyMachine.publicKey.toString());

  // 1. Airdrop
  console.log('\n1. Airdropping SOL...');
  try {
    await umi.rpc.airdrop(keypair.publicKey, sol(2), options.confirm);
    console.log('✅ Airdropped 2 SOL');
  } catch (e) {
    console.log('⚠️ Airdrop failed (may already have SOL):', e.message?.slice(0, 100));
  }

  // 2. Create collection
  console.log('\n2. Creating collection...');
  await createCollectionV1(umi, {
    collection: collectionMint,
    name: 'Test BOA Collection',
    uri: 'https://example.com/collection.json',
  }).sendAndConfirm(umi, options);
  console.log('✅ Collection created');

  // 3. Create candy machine
  console.log('\n3. Creating Core Candy Machine...');
  const createTx = await create(umi, {
    candyMachine,
    collection: collectionMint.publicKey,
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: 10,
    authority: umi.identity.publicKey,
    isMutable: true,
    configLineSettings: some({
      prefixName: 'BOA #',
      nameLength: 4,
      prefixUri: 'https://example.com/',
      uriLength: 50,
      isSequential: false,
    }),
    guards: {},
  });
  await createTx.sendAndConfirm(umi, options);
  console.log('✅ Candy Machine created');

  // 4. Add items
  console.log('\n4. Adding config lines...');
  await addConfigLines(umi, {
    candyMachine: candyMachine.publicKey,
    index: 0,
    configLines: [
      { name: '1', uri: 'test1.json' },
      { name: '2', uri: 'test2.json' },
      { name: '3', uri: 'test3.json' },
    ],
  }).sendAndConfirm(umi, options);
  console.log('✅ Added 3 items');

  // 5. Verify
  console.log('\n5. Verifying...');
  const cm = await fetchCandyMachine(umi, candyMachine.publicKey, options.confirm);
  console.log(`Items loaded: ${cm.itemsLoaded}/10`);
  console.log(`Items redeemed: ${cm.itemsRedeemed}`);

  // 6. Mint
  console.log('\n6. Minting...');
  const asset = generateSigner(umi);
  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintV1(umi, {
        candyMachine: candyMachine.publicKey,
        asset,
        collection: collectionMint.publicKey,
      })
    )
    .sendAndConfirm(umi, options);
  console.log('✅ Minted! Asset:', asset.publicKey.toString());

  // 7. Verify again
  const cm2 = await fetchCandyMachine(umi, candyMachine.publicKey, options.confirm);
  console.log(`Items redeemed: ${cm2.itemsRedeemed}`);

  console.log('\n🎉 ALL TESTS PASSED!');
}

main().catch(e => {
  console.error('Fatal:', e.message || e);
  if (e.logs) console.error('Logs:', e.logs);
  process.exit(1);
});
