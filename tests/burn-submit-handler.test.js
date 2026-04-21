const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '../src/routes/burn-to-become-public.js');

function loadBurnModule() {
  const originalLoad = Module._load;
  const originalEnv = {
    DEPLOYER_KEY_PATH: process.env.DEPLOYER_KEY_PATH,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  };

  class PublicKey {
    constructor(value) {
      this.value = String(value || '');
    }
    toBase58() {
      return this.value;
    }
    equals(other) {
      return !!other && this.toBase58() === (typeof other.toBase58 === 'function' ? other.toBase58() : String(other));
    }
    toBuffer() {
      return Buffer.alloc(32, 1);
    }
    static findProgramAddressSync() {
      return [new PublicKey('Pda11111111111111111111111111111111111111111'), 255];
    }
  }

  class Connection {
    constructor() {}
  }

  const fakeFs = {
    ...require('node:fs'),
    readFileSync(filePath, ...args) {
      if (String(filePath).includes('devnet-deployer.json')) {
        return JSON.stringify(Array.from({ length: 64 }, () => 1));
      }
      return require('node:fs').readFileSync(filePath, ...args);
    },
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@solana/web3.js') {
      return {
        Connection,
        PublicKey,
        Transaction: class {},
        VersionedTransaction: class {},
        TransactionInstruction: class {},
        Keypair: {
          fromSecretKey() {
            return { publicKey: new PublicKey('Deployer111111111111111111111111111111111111') };
          },
        },
        SystemProgram: { programId: new PublicKey('11111111111111111111111111111111') },
        ComputeBudgetProgram: { programId: new PublicKey('ComputeBudget111111111111111111111111111111') },
      };
    }
    if (request === '@solana/spl-token') {
      return {
        TOKEN_PROGRAM_ID: new PublicKey('Token1111111111111111111111111111111111111'),
        TOKEN_2022_PROGRAM_ID: new PublicKey('Token2022111111111111111111111111111111'),
        getAssociatedTokenAddress: async () => new PublicKey('Ata111111111111111111111111111111111111111'),
        createBurnInstruction() {},
        createCloseAccountInstruction() {},
        createAssociatedTokenAccountInstruction() {},
        createInitializeMintInstruction() {},
        createMintToInstruction() {},
        createInitializeNonTransferableMintInstruction() {},
        createInitializeMetadataPointerInstruction() {},
        getMintLen() { return 0; },
        ExtensionType: {},
      };
    }
    if (request === '@solana/spl-token-metadata') {
      return {
        createInitializeInstruction() {},
        createUpdateFieldInstruction() {},
        pack() { return Buffer.alloc(0); },
      };
    }
    if (request === 'fs') return fakeFs;
    if (request === 'bs58') return {};
    if (request === './safe-burn-to-become') {
      return { safeBurnToBecome: async () => ({ success: true }) };
    }
    return originalLoad(request, parent, isMain);
  };

  process.env.DEPLOYER_KEY_PATH = '/tmp/devnet-deployer.json';
  process.env.SOLANA_RPC_URL = 'http://localhost:8899';

  delete require.cache[targetPath];
  const mod = require(targetPath);

  return {
    mod,
    restore() {
      Module._load = originalLoad;
      if (originalEnv.DEPLOYER_KEY_PATH === undefined) delete process.env.DEPLOYER_KEY_PATH;
      else process.env.DEPLOYER_KEY_PATH = originalEnv.DEPLOYER_KEY_PATH;
      if (originalEnv.SOLANA_RPC_URL === undefined) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = originalEnv.SOLANA_RPC_URL;
      delete require.cache[targetPath];
    },
  };
}

let cleanup = null;

afterEach(() => {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
});

describe('burn submit handler regression guard', () => {
  it('returns a 400 when submit is missing both signedTransaction and txSignature', () => {
    const loaded = loadBurnModule();
    cleanup = loaded.restore;

    let statusCode = null;
    let headers = null;
    let payload = null;
    const req = {
      method: 'POST',
      body: {
        wallet: 'Wallet1111111111111111111111111111111111111',
        nftMint: 'Mint111111111111111111111111111111111111111',
      },
    };
    const res = {
      writeHead(code, hdrs) {
        statusCode = code;
        headers = hdrs;
      },
      end(body) {
        payload = JSON.parse(body);
      },
    };
    const url = new URL('http://localhost/api/burn-to-become/submit');

    const handled = loaded.mod.handleBurnToBecome(req, res, url);

    assert.strictEqual(handled, true);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.match(payload.error, /either signedTransaction or txSignature required/);
  });

  it('returns false for unrelated routes', () => {
    const loaded = loadBurnModule();
    cleanup = loaded.restore;

    const handled = loaded.mod.handleBurnToBecome(
      { method: 'GET' },
      { writeHead() {}, end() {} },
      new URL('http://localhost/not-burn')
    );

    assert.strictEqual(handled, false);
  });
});
