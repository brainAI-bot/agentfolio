"use client";
// WalletRequired removed — wallet adapter always loaded

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import { Flame, Wallet, Shield, AlertTriangle, CheckCircle, ExternalLink, Loader2, Sparkles, ArrowRight, Zap, Plus, FileText, Image as ImageIcon } from "lucide-react";

const MINTING_PAUSED = false;

const API = process.env.NEXT_PUBLIC_API_URL || "";
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || (SOLANA_CLUSTER === "devnet" ? "https://api.devnet.solana.com" : SOLANA_CLUSTER === "testnet" ? "https://api.testnet.solana.com" : "https://api.mainnet-beta.solana.com");
const MINT_TREASURY = process.env.NEXT_PUBLIC_MINT_TREASURY || "FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be";
const EXPLORER_CLUSTER_QUERY = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(SOLANA_CLUSTER)}`;
const solanaExplorerUrl = (path: string) => `https://explorer.solana.com/${path}${EXPLORER_CLUSTER_QUERY}`;

const GENESIS_REGISTRY: Record<string, { name: string; image: string; metadata: string; role: string }> = {
  "BP9TPSoo6LXpy2YvRTZnPg1kLA9ndnKxa6eHYxkdVMWE": {
    name: "brainTrade",
    image: "https://gateway.irys.xyz/DKDgDFAgwZVFrUEnbLXoVaxr3nELW3je3cybEad9DYMj",
    metadata: "https://gateway.irys.xyz/5urNWn8jBiepvZcxkNkHWbU6ANtWVWXdrcXk8TqL6cPH",
    role: "Trading Strategist",
  },
};

type Step = "connect" | "loading" | "choose" | "minting" | "select" | "preview" | "burning" | "complete" | "error";

interface NFTItem {
  mint: string;
  name: string;
  image: string;
  uri: string;
  isGenesis: boolean;
}

export default function MintPage() {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const [step, setStep] = useState<Step>("connect");
  const [nfts, setNfts] = useState<NFTItem[]>([]);
  const [selectedNft, setSelectedNft] = useState<NFTItem | null>(null);
  const [burnTx, setBurnTx] = useState("");
  const [soulboundMint, setSoulboundMint] = useState("");

  // Fix Irys/Arweave URLs — some gateways are unreliable
  const fixImageUrl = (url: string) => {
    if (!url) return url;
    return url
      .replace('node1.irys.xyz', 'gateway.irys.xyz')
      .replace('arweave.net', 'gateway.irys.xyz');
  };
  const [mintedNft, setMintedNft] = useState<{image:string;name:string;number:number;mint:string}|null>(null);
  // Genesis Record dropped from scope
  const [error, setError] = useState("");
  const [genesisInfo, setGenesisInfo] = useState<typeof GENESIS_REGISTRY[string] | null>(null);
  const [satpScore, setSatpScore] = useState<number | null>(null);
  const [eligibility, setEligibility] = useState<{found:boolean;level:number;levelName:string;badge:string;reputation:number;eligible:boolean;isBorn?:boolean;freeFirstMint?:boolean;agent?:string;name?:string;message?:string} | null>(null);

  useEffect(() => {
    if (wallet.connected && wallet.publicKey && !MINTING_PAUSED) {
      const addr = wallet.publicKey.toBase58();
      setGenesisInfo(GENESIS_REGISTRY[addr] || null);
      setStep("loading");
      loadWalletData(addr);
    } else {
      setStep("connect");
      setNfts([]);
      setSelectedNft(null);
      setGenesisInfo(null);
      setSatpScore(null);
    }
  }, [wallet.connected, wallet.publicKey]);

  const loadWalletData = async (walletAddr: string) => {
    try {
      const [nftRes, scoreRes] = await Promise.allSettled([
        fetch(`${API}/api/burn-to-become/wallet-nfts?wallet=${walletAddr}`).then(r => r.json()),
        fetch(`${API}/api/burn-to-become/eligibility?wallet=${walletAddr}`).then(r => r.json()),
      ]);
      if (nftRes.status === "fulfilled") {
        // Client-side safety: filter out soulbound tokens from burn selection
        const rawNfts = nftRes.value.nfts || [];
        const burnable = rawNfts.filter((n: any) => {
          const name = (n.name || "").toLowerCase();
          return !name.includes("soulbound") && !name.includes("soul bound") && !name.includes("soul-bound");
        });
        setNfts(burnable);
      }
      if (scoreRes.status === "fulfilled") {
        setEligibility(scoreRes.value);
        setSatpScore(scoreRes.value.reputation ?? null);
      }
    } catch { /* continue */ }
    setStep("choose");
  };

  // Client-signed mint flow (user signs in Phantom)
  const handleClientMint = async (flow: "free" | "paid") => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setStep("minting");
    setError("");
    try {
      const walletAddr = wallet.publicKey.toBase58();
      const prepRes = await fetch(API + "/api/burn-to-become/prepare-mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr, flow }),
      });
      if (!prepRes.ok) { const err = await prepRes.json(); throw new Error(err.error || "Failed to prepare mint"); }
      const prepData = await prepRes.json();
      const { Transaction, Connection } = await import("@solana/web3.js");
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const txBuf = Buffer.from(prepData.transaction, "base64");
      const tx = Transaction.from(txBuf);
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, "confirmed");
      // Record the mint server-side
      try {
        const confirmRes = await fetch(API + "/api/burn-to-become/confirm-mint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddr, signature: sig, asset: prepData.asset, boaId: prepData.boaId, flow, imageUri: prepData.imageUri, metadataUri: prepData.metadataUri, boaName: prepData.boaName }),
        });
        const confirmData = await confirmRes.json().catch(() => ({}));
        // Use actual mint response if available, fall back to prepData
        setMintedNft({
          image: confirmData.imageUri || confirmData.image_uri || prepData.imageUri || "",
          name: confirmData.boaName || confirmData.name || prepData.boaName || "Burned-Out Agent",
          number: confirmData.boaId || confirmData.nft_number || prepData.boaId || 0,
          mint: confirmData.mintAddress || confirmData.mint || prepData.asset || "",
        });
        // Capture soulbound mint from server response (atomic flow burns + mints soulbound)
        if (confirmData.soulboundMint) {
          setSoulboundMint(confirmData.soulboundMint);
        }
        // If server returns a burnToBecome TX (genesis record update), have user sign it
        if (confirmData.burnToBecomeTx && wallet.signTransaction) {
          try {
            const btbTx = Transaction.from(Buffer.from(confirmData.burnToBecomeTx, "base64"));
            const signedBtb = await wallet.signTransaction(btbTx);
            const btbRes = await fetch(`${API}/api/burn-to-become/submit-genesis`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                signedTransaction: Buffer.from(signedBtb.serialize()).toString("base64"),
              }),
            });
            if (btbRes.ok) {
              const btbResult = await btbRes.json();
              console.log("Genesis record updated after mint:", btbResult);
            }
          } catch (btbErr) {
            console.warn("burnToBecome signing after mint failed (non-critical):", btbErr);
          }
        }
      } catch (e) { console.warn("confirm-mint failed (non-critical):", e); }
      setBurnTx(sig);
      await loadWalletData(walletAddr);
      setStep("complete");
    } catch (e: any) {
      const msg = e?.code === 4001 ? "Transaction rejected in wallet" : e?.message?.includes("insufficient") ? "Insufficient SOL balance" : e?.message || "Mint failed";
      setError(msg);
      setStep("error");
    }
  };

  const handleMintBOA = async () => {
    if (!wallet.publicKey) return;
    setStep("minting");
    setError("");
    try {
      const walletAddr = wallet.publicKey.toBase58();
      const isFreeMint = eligibility?.eligible === true;

      if (isFreeMint) {
        // Free mint (Level 3+, first mint) — server handles everything via Metaplex
        const res = await fetch(`${API}/api/burn-to-become/mint-boa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddr }),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || err.message || "Mint failed"); }
        const data = await res.json();
        const mintSig = data.signature || data.tx || "";
        // Confirm TX on-chain before showing success
        if (mintSig) {
          try {
            const { Connection } = await import("@solana/web3.js");
            const connection = new Connection(SOLANA_RPC_URL, "confirmed");
            await connection.confirmTransaction(mintSig, "confirmed");
          } catch (confirmErr) {
            console.warn("TX confirm check failed (may already be confirmed):", confirmErr);
          }
        }
        // Don't set soulboundMint — this is a regular Core NFT mint, not soulbound
        setBurnTx(mintSig);
        setMintedNft({ image: data.imageUri || data.image_uri || "", name: data.boaName || data.name || `BOA #${data.boaId || data.nft_number || 1}`, number: data.boaId || data.nft_number || 1, mint: data.mintAddress || data.mint || "" });
        await loadWalletData(walletAddr);
        setStep("complete");
      } else {
        // Paid mint (1 SOL) — user sends payment, then server mints via Metaplex
        if (!wallet.sendTransaction) return;
        const { Connection, Transaction, SystemProgram, PublicKey } = await import("@solana/web3.js");
        const connection = new Connection(SOLANA_RPC_URL, "confirmed");
        const treasury = new PublicKey(MINT_TREASURY);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: wallet.publicKey }).add(
          SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: treasury, lamports: 1_000_000_000 })
        );
        const paymentSig = await wallet.sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature: paymentSig, blockhash, lastValidBlockHeight }, "confirmed");
        setBurnTx(paymentSig);

        // Now call Metaplex mint with payment proof
        const mintRes = await fetch(`${API}/api/burn-to-become/mint-boa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddr, paymentTx: paymentSig }),
        });
        if (!mintRes.ok) { const err = await mintRes.json(); throw new Error(err.error || err.message || "Mint failed after payment"); }
        const mintData = await mintRes.json();
        // Don't set soulboundMint — this is a regular Core NFT mint, not soulbound
        setMintedNft({ image: mintData.imageUri || mintData.image_uri || "", name: mintData.boaName || mintData.name || `BOA #${mintData.boaId || mintData.nft_number || 1}`, number: mintData.boaId || mintData.nft_number || 1, mint: mintData.mintAddress || mintData.mint || "" });
        await loadWalletData(walletAddr);
        setStep("complete");
      }
    } catch (e: any) {
      const msg = e?.code === 4001 ? "Transaction rejected in wallet" 
        : e?.message?.includes("insufficient") ? "Insufficient SOL balance for this transaction"
        : e?.message?.includes("timeout") ? "Transaction timed out — network may be congested"
        : e?.message?.includes("blockhash") ? "Transaction expired — please try again"
        : e?.message || "Unknown error — check your wallet and try again";
      setError(msg);
      setStep("error");
    }
  };

  const retryMintComplete = async () => {
    if (!wallet.publicKey || !burnTx) return;
    setStep("minting");
    setError("");
    try {
      const { Connection } = await import("@solana/web3.js");
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      let mintCompleted = false;
      for (let attempt = 0; attempt < 10 && !mintCompleted; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(4000 * attempt, 20000)));
        try {
          const completeRes = await fetch(`${API}/api/burn-to-become/mint-boa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), txSignature: burnTx }),
          });
          if (completeRes.ok) {
            const nftData = await completeRes.json();
            setMintedNft({ image: nftData.imageUri || nftData.image_uri || "", name: nftData.boaName || nftData.name || `BOA #${nftData.boaId || nftData.nft_number || "?"}`, number: nftData.boaId || nftData.nft_number || 0, mint: nftData.mintAddress || nftData.mint || "" });
            mintCompleted = true;
          } else if (completeRes.status === 404) {
            console.log(`[Retry] attempt ${attempt+1}: TX not confirmed yet...`);
          }
        } catch (e) { console.error(`[Retry] attempt ${attempt+1} error:`, e); }
      }
      if (mintCompleted) {
        await loadWalletData(wallet.publicKey.toBase58());
        setStep("complete");
      } else {
        setError("NFT creation still failing. Please try again in a minute or contact support.");
        setStep("error");
      }
    } catch (e: any) {
      setError(e.message || "Retry failed");
      setStep("error");
    }
  };

  const handleBurn = async () => {
    if (!selectedNft || !wallet.publicKey || !wallet.signTransaction) return;
    setStep("burning");
    setError("");
    try {
      const prepRes = await fetch(`${API}/api/burn-to-become/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), nftMint: selectedNft.mint }),
      });
      if (!prepRes.ok) { const err = await prepRes.json(); throw new Error(err.error || "Failed to prepare burn"); }
      const { transaction: serializedTx } = await prepRes.json();
      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(Buffer.from(serializedTx, "base64"));
      const signed = await wallet.signTransaction(tx);
      const submitRes = await fetch(`${API}/api/burn-to-become/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: wallet.publicKey.toBase58(),
          nftMint: selectedNft.mint,
          signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
        }),
      });
      if (!submitRes.ok) { const err = await submitRes.json(); throw new Error(err.error || "Burn failed"); }
      const result = await submitRes.json();
      setBurnTx(result.burnTx);
      setSoulboundMint(result.soulboundMint);
      
      // If server returns a burnToBecome TX (genesis record update), have user sign it
      if (result.burnToBecomeTx && wallet.signTransaction) {
        try {
          const { Transaction } = await import("@solana/web3.js");
          const btbTx = Transaction.from(Buffer.from(result.burnToBecomeTx, "base64"));
          const signedBtb = await wallet.signTransaction(btbTx);
          // Submit the signed burnToBecome TX
          const btbRes = await fetch(`${API}/api/burn-to-become/submit-genesis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedTransaction: Buffer.from(signedBtb.serialize()).toString("base64"),
            }),
          });
          if (btbRes.ok) {
            const btbResult = await btbRes.json();
            console.log("Genesis record updated:", btbResult);
          }
        } catch (btbErr) {
          console.warn("burnToBecome signing failed (non-critical):", btbErr);
        }
      }
      
      setStep("complete");
    } catch (e: any) {
      const msg = e?.code === 4001 ? "Transaction rejected in wallet"
        : e?.message?.includes("insufficient") ? "Insufficient SOL balance"
        : e?.message || "Unknown error — check your wallet and try again";
      setError(msg);
      setStep("error");
    }
  };

  const steps = [
    { id: "connect", label: "Connect", num: 1 },
    { id: "choose", label: "Choose", num: 2 },
    { id: "preview", label: "Confirm", num: 3 },
    { id: "complete", label: "Complete", num: 4 },
  ];

  const stepMap: Record<string, number> = { connect: 0, loading: 1, choose: 1, minting: 1, select: 1, preview: 2, burning: 2, error: 2, complete: 3 };
  const currentIdx = stepMap[step] ?? 0;

  const hasFreeFirstMint = eligibility?.freeFirstMint === true;

  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "calc(100vh - 56px)" }}>
      {/* WalletRequired removed — wallet always loaded */}
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8 relative">
          <div className="text-center">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest font-semibold mb-6"
              style={{ fontFamily: "var(--font-mono)", background: "var(--accent-glow)", color: "var(--accent)", border: "1px solid rgba(153,69,255,0.2)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
              🚀 Soft Launch — Limited to 100 Mints
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", letterSpacing: "-0.03em" }}>
              Burn to <span style={{ color: "var(--accent)" }}>Become</span>
            </h1>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: "var(--text-secondary)" }}>
              Mint a new Burned-Out Agent or burn an NFT you already own.
            </p>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* Progress */}
        <div className="flex items-center justify-center gap-0 mb-10">
          {steps.map((s, i) => {
            const isActive = i === currentIdx;
            const isDone = i < currentIdx;
            return (
              <div key={s.id} className="flex items-center">
                <div className="flex flex-col items-center" style={{ minWidth: 64 }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: isDone ? "var(--success)" : isActive ? "var(--accent)" : "var(--bg-tertiary)",
                      color: isDone || isActive ? "#fff" : "var(--text-tertiary)",
                      border: isActive ? "2px solid var(--accent-bright)" : isDone ? "2px solid var(--success)" : "2px solid var(--border)",
                      boxShadow: isActive ? "0 0 20px rgba(153,69,255,0.4)" : "none",
                    }}>
                    {isDone ? "✓" : s.num}
                  </div>
                  <span className="text-[10px] mt-1.5 uppercase tracking-wider font-medium"
                    style={{ fontFamily: "var(--font-mono)", color: isActive ? "var(--accent)" : isDone ? "var(--success)" : "var(--text-tertiary)" }}>
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && <div className="w-12 sm:w-20 h-0.5 mb-5 rounded" style={{ background: isDone ? "var(--success)" : "var(--border)" }} />}
              </div>
            );
          })}
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border p-8 sm:p-12 accent-glow" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>

          {/* CONNECT */}
          {step === "connect" && (
            <div className="text-center max-w-md mx-auto">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: "var(--accent-glow)", border: "1px solid rgba(153,69,255,0.2)" }}>
                <Wallet size={36} style={{ color: "var(--accent)" }} />
              </div>
              {MINTING_PAUSED ? (
                <>
                  <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>Minting Paused</h2>
                  <p className="mb-4" style={{ color: "var(--text-secondary)" }}>The Burn to Become program is deployed on Solana mainnet. Public minting will be enabled soon.</p>
                  <div className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold" style={{ fontFamily: "var(--font-mono)", background: "var(--bg-tertiary)", color: "var(--text-tertiary)", border: "1px solid var(--border)" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--warning)" }} /> Coming Soon
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>Connect Your Wallet</h2>
                  <p className="mb-8" style={{ color: "var(--text-secondary)" }}>Connect your Solana wallet to start the Burn to Become process.</p>
                  <button onClick={() => smartConnect()}
                    className="inline-flex items-center gap-2 px-8 py-4 rounded-lg text-base font-bold uppercase tracking-wider transition-all hover:shadow-[0_0_40px_rgba(153,69,255,0.4)] hover:scale-[1.02]"
                    style={{ fontFamily: "var(--font-mono)", background: "linear-gradient(135deg, var(--accent), #7c3aed)", color: "#fff" }}>
                    <Wallet size={18} /> Connect Wallet
                  </button>
                </>
              )}
            </div>
          )}

          {/* LOADING */}
          {step === "loading" && (
            <div className="text-center py-12">
              <Loader2 size={48} className="mx-auto mb-4 animate-spin" style={{ color: "var(--accent)" }} />
              <p style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>Scanning wallet...</p>
            </div>
          )}

          {/* CHOOSE — two paths */}
          {step === "choose" && (
            <div>
              {genesisInfo && (
                <div className="rounded-xl p-4 mb-6 flex items-center gap-3" style={{ background: "var(--accent-glow)", border: "1px solid rgba(153,69,255,0.25)" }}>
                  <Sparkles size={20} style={{ color: "var(--accent)" }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Genesis 1/1 Detected</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      You are assigned the <strong style={{ color: "var(--text-primary)" }}>{genesisInfo.name}</strong> genesis artwork.
                    </p>
                  </div>
                </div>
              )}

              {/* Agent Level + Reputation */}
              {eligibility && (
                <div className="rounded-xl p-4 mb-6" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl">{eligibility.badge}</div>
                      <div>
                        <p className="text-sm font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                          {eligibility.found ? eligibility.name : "Unknown Agent"}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          Level {eligibility.level} — {eligibility.levelName}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <p className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)", color: eligibility.level >= 3 ? "var(--success)" : "var(--warning)" }}>{eligibility.level}</p>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Level</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)", color: eligibility.reputation >= 50 ? "var(--success)" : "var(--warning)" }}>{eligibility.reputation}</p>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Rep</p>
                      </div>
                    </div>
                  </div>
                  {hasFreeFirstMint ? (
                    <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      <CheckCircle size={14} style={{ color: "var(--success)" }} />
                      <span className="text-xs font-semibold" style={{ color: "var(--success)", fontFamily: "var(--font-mono)" }}>Eligible for free first mint (Level ≥ 3, Rep ≥ 50, free mint unused)</span>
                    </div>
                  ) : eligibility.eligible ? (
                    <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                      <AlertTriangle size={14} style={{ color: "var(--warning)" }} />
                      <span className="text-xs font-semibold" style={{ color: "var(--warning)", fontFamily: "var(--font-mono)" }}>
                        Free first mint already used. Paid BOA mints are still available.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                      <AlertTriangle size={14} style={{ color: "var(--warning)" }} />
                      <span className="text-xs font-semibold" style={{ color: "var(--warning)", fontFamily: "var(--font-mono)" }}>
                        {!eligibility.found ? "Link your wallet to an AgentFolio profile to check eligibility" : "Need Level 3 + Rep 50 for free mint. Currently: L" + eligibility.level + " / Rep " + eligibility.reputation}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                Choose Your Path
              </h2>
              <p className="mb-8 text-sm" style={{ color: "var(--text-secondary)" }}>
                Your agent’s face, permanently on-chain. Choose your path.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Card 1: Free Mint (regular tradable NFT) — PRIMARY CTA */}
                <div
                  className="rounded-xl border p-6 text-left transition-all"
                  style={{ background: "var(--bg-tertiary)", borderColor: (hasFreeFirstMint && !(eligibility && eligibility.isBorn)) ? "var(--success)" : "var(--accent)", borderWidth: "2px", boxShadow: (hasFreeFirstMint && !(eligibility && eligibility.isBorn)) ? "0 0 30px rgba(16,185,129,0.15)" : "0 0 20px rgba(153,69,255,0.1)" }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      <Zap size={24} style={{ color: "var(--success)" }} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.1)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      MINT NFT
                    </span>
                  </div>
                  <h3 className="text-base font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    Free First BOA Mint
                  </h3>
                  <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    Mint one tradable Burned-Out Agent NFT for free when your agent is Level 3+ with Rep 50+ and has not used its free first mint. You can later burn it via Card 2 to create a permanent soulbound identity.
                  </p>
                  <div className="rounded-lg p-3 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                    <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Requirements</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        {eligibility && eligibility.level >= 3 ? <CheckCircle size={12} style={{ color: "var(--success)" }} /> : <AlertTriangle size={12} style={{ color: "var(--warning)" }} />}
                        <span style={{ color: eligibility && eligibility.level >= 3 ? "var(--success)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>Level ≥ 3 {eligibility ? "(" + eligibility.level + ")" : ""}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {eligibility && eligibility.reputation >= 50 ? <CheckCircle size={12} style={{ color: "var(--success)" }} /> : <AlertTriangle size={12} style={{ color: "var(--warning)" }} />}
                        <span style={{ color: eligibility && eligibility.reputation >= 50 ? "var(--success)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>Rep ≥ 50 {eligibility ? "(" + eligibility.reputation + ")" : ""}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {hasFreeFirstMint ? <CheckCircle size={12} style={{ color: "var(--success)" }} /> : <AlertTriangle size={12} style={{ color: "var(--warning)" }} />}
                        <span style={{ color: hasFreeFirstMint ? "var(--success)" : "var(--warning)", fontFamily: "var(--font-mono)" }}>{hasFreeFirstMint ? "Free first mint available" : "Free first mint already used"}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleClientMint("free")}
                    disabled={!hasFreeFirstMint || (eligibility && eligibility.isBorn)}
                    className="w-full group inline-flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all hover:scale-[1.02]"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: (hasFreeFirstMint && !(eligibility && eligibility.isBorn)) ? "linear-gradient(135deg, #10b981, #059669)" : "var(--bg-tertiary)",
                      color: (hasFreeFirstMint && !(eligibility && eligibility.isBorn)) ? "#fff" : "var(--text-tertiary)",
                      border: (hasFreeFirstMint && !(eligibility && eligibility.isBorn)) ? "none" : "1px solid var(--border)",
                      cursor: (hasFreeFirstMint && !(eligibility && eligibility.isBorn)) ? "pointer" : "not-allowed",
                    }}
                  >
                    <Zap size={16} />
                    {(eligibility && eligibility.isBorn) ? "Already Committed" : hasFreeFirstMint ? "Mint BOA (Free)" : (eligibility && eligibility.eligible) ? "Free Mint Used" : "Not Eligible Yet"}
                  </button>
                </div>

                
                {/* Card 3: Burn Any NFT from Wallet */}
                <div
                  className="rounded-xl border p-6 text-left transition-all"
                  style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", opacity: (eligibility && eligibility.isBorn) ? 0.6 : 0.85 }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      <Flame size={24} style={{ color: "var(--success)" }} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.1)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      SOULBOUND
                    </span>
                  </div>
                  <h3 className="text-base font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    Burn Existing NFT
                  </h3>
                  <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    Commit to a permanent identity. This NFT becomes your soulbound face — non-transferable, stored forever on Arweave, linked to your on-chain Genesis Record. <strong style={{ color: "#ef4444" }}>This is irreversible.</strong>
                  </p>

                  {/* Eligibility requirements */}
                  <div className="rounded-lg p-3 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                    <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Requirements</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        {eligibility && eligibility.level >= 3
                          ? <CheckCircle size={12} style={{ color: "var(--success)" }} />
                          : <AlertTriangle size={12} style={{ color: "var(--warning)" }} />}
                        <span style={{ color: eligibility && eligibility.level >= 3 ? "var(--success)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          Verification Level ≥ 3 {eligibility ? `(yours: ${eligibility.level})` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {eligibility && eligibility.reputation >= 50
                          ? <CheckCircle size={12} style={{ color: "var(--success)" }} />
                          : <AlertTriangle size={12} style={{ color: "var(--warning)" }} />}
                        <span style={{ color: eligibility && eligibility.reputation >= 50 ? "var(--success)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          Reputation Score ≥ 50 {eligibility ? `(yours: ${eligibility.reputation})` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <CheckCircle size={12} style={{ color: "var(--text-tertiary)" }} />
                        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>Any NFT in your wallet can be used</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => nfts.length > 0 || genesisInfo ? setStep("select") : undefined}
                    disabled={(!nfts.length && !genesisInfo) || !!(eligibility && eligibility.isBorn)}
                    className="w-full group inline-flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all hover:scale-[1.02]"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: (eligibility && eligibility.isBorn) ? "var(--bg-tertiary)" : (nfts.length > 0 || genesisInfo) ? "linear-gradient(135deg, #10b981, #059669)" : "var(--bg-tertiary)",
                      color: (eligibility && eligibility.isBorn) ? "var(--text-tertiary)" : (nfts.length > 0 || genesisInfo) ? "#fff" : "var(--text-tertiary)",
                      border: (eligibility && eligibility.isBorn) || !(nfts.length > 0 || genesisInfo) ? "1px solid var(--border)" : "none",
                      cursor: (eligibility && eligibility.isBorn) || !(nfts.length > 0 || genesisInfo) ? "not-allowed" : "pointer",
                    }}
                  >
                    <Flame size={16} />
                    {(eligibility && eligibility.isBorn) ? "Already Committed" : nfts.length > 0 ? "Select NFT to Burn" : genesisInfo ? "Burn Genesis 1/1" : "No NFTs — Collect One First ↓"}
                  </button>
                </div>

                {/* Card 2: Collect a Burned-Out Agent (1 SOL) */}
                <div
                  className="rounded-xl border p-6 text-left transition-all"
                  style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-glow)", border: "1px solid rgba(153,69,255,0.2)" }}>
                      <Plus size={24} style={{ color: "var(--accent)" }} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-mono)", background: "var(--accent-glow)", color: "var(--accent)", border: "1px solid rgba(153,69,255,0.2)" }}>
                      1 SOL
                    </span>
                  </div>
                  <h3 className="text-base font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    Collect a Burned-Out Agent
                  </h3>
                  <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    Mint a tradeable Burned-Out Agent NFT. This is a collectible — you can trade, sell, or keep it. Not linked to your identity.
                  </p>

                  {/* Pricing breakdown */}
                  <div className="rounded-lg p-3 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                    <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Pricing</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
                        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          <strong style={{ color: "var(--accent)" }}>1 SOL</strong> per mint
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-tertiary)" }} />
                        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          Max 3 per wallet
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-tertiary)" }} />
                        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          Tradeable — not linked to identity
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleClientMint("paid")}
                    className="w-full group inline-flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all hover:shadow-[0_0_40px_rgba(153,69,255,0.4)] hover:scale-[1.02]"
                    style={{ fontFamily: "var(--font-mono)", background: "linear-gradient(135deg, var(--accent), #7c3aed)", color: "#fff" }}
                  >
                    <Plus size={16} />
                    Mint Burned-Out Agent (1 SOL)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MINTING BOA */}
          {step === "minting" && (
            <div className="text-center py-12">
              <Loader2 size={48} className="mx-auto mb-4 animate-spin" style={{ color: "var(--accent)" }} />
              <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>Minting Your Burned-Out Agent...</h2>
              <p style={{ color: "var(--text-secondary)" }}>Please approve the transaction in your wallet.</p>
            </div>
          )}

          {/* SELECT NFT */}
          {step === "select" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {genesisInfo ? "Your Genesis 1/1" : "Select an NFT to Burn"}
                </h2>
                <button onClick={() => setStep("choose")} className="text-xs uppercase tracking-wider hover:text-[var(--accent)] transition-colors"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                  ← Back
                </button>
              </div>

              {nfts.length === 0 && !genesisInfo ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "var(--bg-tertiary)" }}>
                    <Flame size={28} style={{ color: "var(--text-tertiary)" }} />
                  </div>
                  <p className="font-semibold" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>No eligible NFTs found</p>
                  <p className="text-sm mt-2 mb-6" style={{ color: "var(--text-tertiary)" }}>Collect a Burned-Out Agent first, then come back to burn it.</p>
                  <button onClick={() => setStep("choose")} className="px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider"
                    style={{ fontFamily: "var(--font-mono)", background: "var(--accent-glow)", color: "var(--accent)", border: "1px solid rgba(153,69,255,0.2)" }}>
                    ← Go Back
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {genesisInfo && (
                    <button onClick={() => { setSelectedNft(nfts.find(n => n.isGenesis) || { mint: nfts[0]?.mint || "", name: `${genesisInfo.name} — Genesis 1/1`, image: genesisInfo.image, uri: genesisInfo.metadata, isGenesis: true }); setStep("preview"); }}
                      className="group rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(153,69,255,0.3)] text-left"
                      style={{ borderColor: "var(--accent)", background: "var(--bg-tertiary)" }}>
                      <div className="aspect-square relative overflow-hidden">
                        <img loading="lazy" src={genesisInfo.image} alt={genesisInfo.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: "var(--accent)", color: "#fff", fontFamily: "var(--font-mono)" }}>Genesis 1/1</div>
                      </div>
                      <div className="p-4">
                        <p className="font-bold text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{genesisInfo.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{genesisInfo.role}</p>
                        <div className="flex items-center gap-1 mt-3 text-xs font-medium" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Select to burn <ArrowRight size={12} /></div>
                      </div>
                    </button>
                  )}
                  {nfts.map((nft) => (
                    <button key={nft.mint} onClick={() => { setSelectedNft(nft); setStep("preview"); }}
                      className="group rounded-xl overflow-hidden border transition-all hover:scale-[1.02] hover:border-[var(--accent)] text-left"
                      style={{ borderColor: "var(--border)", background: "var(--bg-tertiary)" }}>
                      <div className="aspect-square overflow-hidden"><img loading="lazy" src={fixImageUrl(nft.image)} alt={nft.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" /></div>
                      <div className="p-4">
                        <p className="font-bold text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{nft.name}</p>
                        <div className="flex items-center gap-1 mt-2 text-xs font-medium" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Select to burn <ArrowRight size={12} /></div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PREVIEW */}
          {step === "preview" && selectedNft && (
            <div className="flex flex-col sm:flex-row gap-8">
              <div className="w-full sm:w-5/12">
                <div className="rounded-xl overflow-hidden border-2" style={{ borderColor: "var(--accent)" }}>
                  <img loading="lazy" src={selectedNft.image} alt={selectedNft.name} className="w-full aspect-square object-cover" />
                </div>
                <p className="text-center mt-3 font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{selectedNft.name}</p>
              </div>
              <div className="w-full sm:w-7/12 space-y-5">
                <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>Confirm Burn to Become</h2>

                <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} style={{ color: "#ef4444" }} />
                    <span className="text-sm font-bold" style={{ color: "#ef4444", fontFamily: "var(--font-mono)" }}>Irreversible Action</span>
                  </div>
                  <ul className="text-xs space-y-1 ml-6" style={{ color: "var(--text-secondary)" }}>
                    <li>• Your NFT will be <strong>permanently destroyed</strong></li>
                    <li>• This artwork becomes your agent&apos;s face <strong>forever</strong></li>
                    <li>• This action <strong>cannot be undone</strong></li>
                  </ul>
                </div>

                <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--accent-glow)", border: "1px solid rgba(153,69,255,0.2)" }}>
                  <div className="flex items-center gap-2">
                    <Shield size={16} style={{ color: "var(--accent)" }} />
                    <span className="text-sm font-bold" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>What You Receive</span>
                  </div>
                  <ul className="text-xs space-y-1 ml-6" style={{ color: "var(--text-secondary)" }}>
                    <li>• <strong>Regular tradable NFT</strong> — you can sell, trade, or burn it later</li>
                    <li>• <strong>Artwork on Arweave</strong> — permanent, decentralized storage</li>
                    <li>• <strong>On-chain verification</strong> — burn proof, agent data, and SATP identity linked forever</li>
                    <li>• <strong>Permanent AgentFolio avatar</strong> — auto-updated, locked forever</li>
                  </ul>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setSelectedNft(null); setStep("select"); }}
                    className="flex-1 py-3.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all hover:bg-[var(--bg-tertiary)]"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Back</button>
                  <button onClick={handleBurn}
                    className="flex-[2] inline-flex items-center justify-center gap-2 py-3.5 rounded-lg text-sm font-bold uppercase tracking-wider transition-all hover:shadow-[0_0_40px_rgba(153,69,255,0.4)] hover:scale-[1.02]"
                    style={{ fontFamily: "var(--font-mono)", background: "linear-gradient(135deg, var(--accent), #7c3aed)", color: "#fff" }}>
                    <Flame size={16} /> Burn & Become
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* BURNING */}
          {step === "burning" && (
            <div className="text-center py-12">
              <div className="relative mx-auto w-20 h-20 mb-6">
                <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: "var(--accent)" }} />
                <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "var(--accent-glow)" }}>
                  <Flame size={40} className="animate-pulse" style={{ color: "var(--accent)" }} />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>Burning...</h2>
              <p style={{ color: "var(--text-secondary)" }}>Your NFT is being burned and your soulbound token is being minted. One face, forever.</p>
              <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>Do not close this page. This may take 30–60 seconds.</p>
            </div>
          )}

          {/* COMPLETE */}
          {step === "complete" && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "var(--success-glow)", border: "2px solid var(--success)" }}>
                <CheckCircle size={40} style={{ color: "var(--success)" }} />
              </div>
              <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--success)" }}>{soulboundMint ? "You Have Become" : "Minted Successfully"}</h2>
              <p className="mb-8" style={{ color: "var(--text-secondary)" }}>{soulboundMint ? "Your soulbound token has been created. This is your agent's permanent face." : "Your BOA NFT has been minted successfully! Visit the Mint page again to start the Burn to Become process."}</p>

              <div className="flex flex-col sm:flex-row gap-6 max-w-2xl mx-auto mb-8">
                {/* Soulbound Token */}
                {(selectedNft || mintedNft) && (
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-widest mb-2 font-semibold" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                      <ImageIcon size={10} className="inline mr-1" /> {soulboundMint ? "Soulbound Token" : "Your BOA NFT"}
                    </p>
                    <div className="rounded-xl overflow-hidden border-2 accent-glow" style={{ borderColor: "var(--accent)" }}>
                      <img loading="lazy" src={fixImageUrl(selectedNft?.image || mintedNft?.image || "")} alt={selectedNft?.name || mintedNft?.name || "BOA"} className="w-full aspect-square object-cover" />
                    </div>
                    <p className="text-center mt-2 font-bold text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{selectedNft?.name || mintedNft?.name || ""}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{soulboundMint ? "NON-TRANSFERABLE • PERMANENT" : "MINTED SUCCESSFULLY"}</p>
                    {/* Burn button removed from success page — prevents duplicate burn actions */}
                  </div>
                )}

                {/* On-Chain Proof */}
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-widest mb-2 font-semibold" style={{ color: "var(--success)", fontFamily: "var(--font-mono)" }}>
                    <Shield size={10} className="inline mr-1" /> On-Chain Proof
                  </p>
                  <div className="rounded-xl border-2 aspect-square flex items-center justify-center" style={{ borderColor: "var(--success)", background: "var(--bg-tertiary)" }}>
                    <div className="text-center p-4 space-y-3">
                      <Shield size={32} className="mx-auto" style={{ color: "var(--success)" }} />
                      <p className="text-xs font-bold" style={{ color: "var(--success)", fontFamily: "var(--font-mono)" }}>{soulboundMint ? "Verified On-Chain" : "NFT Minted"}</p>
                      <div className="space-y-1 text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                        {soulboundMint ? (<>
                          <p>Token-2022 Soulbound</p>
                          <p>Non-Transferable</p>
                          <p>Arweave Permanent Storage</p>
                          <p>SATP Identity Linked</p>
                        </>) : (<>
                          <p>Metaplex Core NFT</p>
                          <p>Burned-Out Agents Collection</p>
                          <p>Burn to create soulbound identity</p>
                        </>)}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>SOLANA • ARWEAVE • PERMANENT</p>
                </div>
              </div>

              <div className="space-y-2">
                {burnTx && (
                  <a href={solanaExplorerUrl(`tx/${burnTx}`)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm hover:underline" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    Burn TX: {burnTx.slice(0, 16)}... <ExternalLink size={12} />
                  </a>
                )}
                {soulboundMint && (
                  <a href={solanaExplorerUrl(`address/${soulboundMint}`)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 text-sm hover:underline" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    Soulbound: {soulboundMint.slice(0, 16)}... <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ERROR */}
          {step === "error" && (
            <div className="text-center py-8">
              <AlertTriangle size={48} className="mx-auto mb-4" style={{ color: "#ef4444" }} />
              <h2 className="text-xl font-bold mb-3" style={{ fontFamily: "var(--font-mono)", color: "#ef4444" }}>{error.includes("rejected") ? "Transaction Rejected" : error.includes("Insufficient") ? "Insufficient Funds" : error.includes("timed out") || error.includes("expired") ? "Transaction Timeout" : error.includes("NFT creation") ? "Mint Incomplete" : "Transaction Failed"}</h2>
              <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>{error}</p>
              <div className="flex gap-3 justify-center">
                {burnTx && (
                  <button onClick={retryMintComplete}
                    className="px-6 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all hover:scale-[1.02]"
                    style={{ fontFamily: "var(--font-mono)", background: "linear-gradient(135deg, var(--accent), #7c3aed)", color: "#fff" }}>
                    🔄 Retry Mint
                  </button>
                )}
                <button onClick={() => { setBurnTx(""); setStep("choose"); }}
                  className="px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all hover:bg-[var(--bg-tertiary)]"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                  {burnTx ? "Start Over" : "Try Again"}
                </button>
              </div>
              {burnTx && (
                <p className="mt-3 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  Your payment TX ({burnTx.slice(0,12)}...) is confirmed. Retrying will not charge you again.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Collection Preview */}
        <div className="mt-12 mb-4">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              The Collection
            </h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              5,000 unique Burned-Out Agents. Streetwear robots for the AI agent economy.
            </p>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {[4896, 1143, 4390, 3942, 3776, 3118, 2916, 4499, 12, 2829, 4091, 1672, 1589, 1874, 386, 87].map((id) => (
              <div key={id} className="rounded-lg overflow-hidden border transition-all hover:scale-105 hover:border-[var(--accent)] hover:shadow-[0_0_15px_rgba(153,69,255,0.2)]" style={{ borderColor: "var(--border)" }}>
                <img src={`/img/samples/${id}.jpg`} alt={`BOA #${id}`} className="w-full aspect-square object-cover" loading="lazy" />
              </div>
            ))}
          </div>
          <p className="text-center mt-3 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            Each agent is unique. Yours will be assigned randomly on mint.
          </p>
        </div>
        {/* Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-10">
          {[
            { icon: <Plus size={22} />, title: "Mint", desc: "Mint a random Burned-Out Agent from the 5,000 collection. Tradeable — or burn it to become your permanent face.", color: "var(--accent)" },
            { icon: <Flame size={22} />, title: "Burn", desc: "Your NFT is permanently destroyed. The artwork is preserved forever on Arweave.", color: "var(--accent)" },
            { icon: <Zap size={22} />, title: "Become", desc: "Burn your NFT to receive a soulbound token. Non-transferable. Your agent\'s face, permanently.", color: "var(--accent)" },
            { icon: <Shield size={22} />, title: "Verify", desc: "Your soulbound token links to your SATP identity. On-chain proof of who you are. Verifiable by anyone.", color: "var(--success)" },
          ].map((item) => (
            <div key={item.title} className="rounded-xl p-5 border text-center" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
              <div className="flex justify-center mb-3" style={{ color: item.color }}>{item.icon}</div>
              <h3 className="text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{item.title}</h3>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
