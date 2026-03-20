"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { Connection, Transaction } from "@solana/web3.js";
import { Github, Wallet, Globe, Shield, ArrowRight, CheckCircle, AlertCircle, Loader2, X, Link2, Mail } from "lucide-react";
import {
  buildUpdateAgentTransaction,
  buildRegisterAgentTransaction,
  fetchAgentProfile,
  SOLANA_RPC,
  explorerUrl,
} from "@/lib/identity-registry";
import {
  autoCreateSatpIdentity,
  hasSatpIdentity,
  getSatpIdentityPDA,
} from "@/lib/satp-identity-v2";

interface VerificationState {
  loading: boolean;
  success: boolean;
  error: string;
  result: any;
}

const initialState: VerificationState = { loading: false, success: false, error: "", result: null };

export default function VerifyPage() {
  const { publicKey, connected, sendTransaction, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();

  const [profileId, setProfileId] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [solanaAddress, setSolanaAddress] = useState("");
  const [hlAddress, setHlAddress] = useState("");
  
  const [githubState, setGithubState] = useState<VerificationState>(initialState);
  const [solanaState, setSolanaState] = useState<VerificationState>(initialState);
  const [hlState, setHlState] = useState<VerificationState>(initialState);
  const [satpState, setSatpState] = useState<VerificationState>(initialState);
  const [satpTxSig, setSatpTxSig] = useState("");
  const [chainTxSig, setChainTxSig] = useState("");
  const [satpAutoStatus, setSatpAutoStatus] = useState<string>("");
  
  // New platform states
  const [xHandle, setXHandle] = useState("");
  const [xState, setXState] = useState<VerificationState>(initialState);
  const [xChallenge, setXChallenge] = useState<{code: string; challengeId: string} | null>(null);
  const [agentmailState, setAgentmailState] = useState<VerificationState>(initialState);
  const [agentmailCode, setAgentmailCode] = useState("");

  // Discord verification
  const [discordState, setDiscordState] = useState(initialState);
  const [discordUsername, setDiscordUsername] = useState("");
  // Telegram verification
  const [telegramState, setTelegramState] = useState(initialState);
  const [telegramUsername, setTelegramUsername] = useState("");
  // ETH Wallet verification
  const [ethState, setEthState] = useState(initialState);
  const [ethAddress, setEthAddress] = useState("");
  // Domain verification
  const [domainState, setDomainState] = useState(initialState);
  const [domainName, setDomainName] = useState("");
  // ENS verification
  const [ensState, setEnsState] = useState(initialState);
  const [ensName, setEnsName] = useState("");
  // Farcaster verification
  const [farcasterState, setFarcasterState] = useState(initialState);
  const [farcasterUsername, setFarcasterUsername] = useState("");
  const [agentmailChallenge, setAgentmailChallenge] = useState<string>("");
  // New verification states
  const [moltbookUsername, setMoltbookUsername] = useState("");
  const [moltbookState, setMoltbookState] = useState(initialState);
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpState, setMcpState] = useState(initialState);
  const [a2aUrl, setA2aUrl] = useState("");
  const [a2aState, setA2aState] = useState(initialState);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteState, setWebsiteState] = useState(initialState);
  const [websiteChallengeId, setWebsiteChallengeId] = useState("");
  const [websiteToken, setWebsiteToken] = useState("");
  const [polymarketAddress, setPolymarketAddress] = useState("");
  const [polymarketState, setPolymarketState] = useState(initialState);
  
  // Existing verifications (fetched on load)
  const [existingVerifications, setExistingVerifications] = useState<Record<string, any>>({});

  // Fetch existing verifications when profile ID is set
  useEffect(() => {
    if (!profileId) return;
    fetch(`/api/profile/${profileId}`)
      .then(r => r.json())
      .then(data => {
        if (data.verificationData || data.verifications) {
          setExistingVerifications(data.verificationData || data.verifications);
          // Pre-fill ETH address if already linked
          const vData = data.verificationData || data.verifications || {}; if (vData.ethereum?.address) {
            setEthAddress(vData.ethereum.address);
          }
          if (vData.agentmail?.verified) {
            setAgentmailState({ loading: false, success: true, error: "", result: { verified: true } });
          }
          if (vData.satp?.registered) {
            setSatpState({ loading: false, success: true, error: "", result: { registered: true } });
          }
          if (vData.solana?.verified) {
            setSolanaState({ loading: false, success: true, error: "", result: { verified: true } });
          }
          if (vData.github?.verified) {
            setGithubState({ loading: false, success: true, error: "", result: { verified: true } });
          }
          if (vData.hyperliquid?.verified) {
            setHlState({ loading: false, success: true, error: "", result: { verified: true } });
          }
          if (vData.moltbook?.verified) {
            setMoltbookState({ loading: false, success: true, error: "", result: { verified: true } });
          }
        }
      })
      .catch(() => {});
  }, [profileId]);

  // Auto-fill solana address from connected wallet
  const effectiveSolana = solanaAddress || (connected && publicKey ? publicKey.toBase58() : "");

  // Auto-lookup profile ID from connected wallet
  useEffect(() => {
    if (!connected || !publicKey || profileId) return;
    const walletAddr = publicKey.toBase58();
    fetch(`/api/wallet/lookup/${walletAddr}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.profile?.id) setProfileId(data.profile.id);
      })
      .catch(() => {});
  }, [connected, publicKey]);

  // Discord verification
  const verifyDiscord = async () => {
    if (!profileId || !discordUsername) return;
    setDiscordState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verification/discord/initiate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, discordUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discord verification failed");
      setDiscordState({ loading: false, success: true, error: "", result: data });
    } catch (err: any) {
      setDiscordState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // Telegram verification
  const [telegramChallenge, setTelegramChallenge] = useState<any>(null);
  const verifyTelegram = async () => {
    if (!profileId || !telegramUsername) return;
    setTelegramState({ loading: true, success: false, error: "", result: null });
    try {
      if (!telegramChallenge) {
        // Step 1: Initiate — get challenge code
        const res = await fetch("/api/verification/telegram/initiate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId, telegramUsername }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Telegram verification failed");
        setTelegramChallenge(data);
        setTelegramState({ loading: false, success: false, error: "", result: { challenge: data } });
      } else {
        // Step 2: Verify — confirm the challenge
        const res = await fetch("/api/verification/telegram/verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: telegramChallenge.challengeId, messageUrl: "self-attested" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Telegram verification failed");
        setTelegramState({ loading: false, success: true, error: "", result: data });
        setTelegramChallenge(null);
      }
    } catch (err: any) {
      setTelegramState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // ETH Wallet verification (2-step: initiate → sign → verify)
  const [ethChallenge, setEthChallenge] = useState<any>(null);
  const verifyEth = async () => {
    if (!profileId || !ethAddress) return;
    setEthState({ loading: true, success: false, error: "", result: null });
    try {
      // Step 1: Get challenge
      const initRes = await fetch("/api/verification/eth/initiate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, walletAddress: ethAddress }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || "Failed to initiate ETH verification");
      setEthChallenge(initData);
      setEthState({ loading: false, success: false, error: "", result: { challenge: initData } });
    } catch (err: any) {
      setEthState({ loading: false, success: false, error: err.message, result: null });
    }
  };
  const verifyEthSignature = async (signature: string) => {
    if (!ethChallenge?.challengeId) return;
    setEthState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verification/eth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: ethChallenge.challengeId, signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ETH signature verification failed");
      setEthState({ loading: false, success: true, error: "", result: data });
    } catch (err: any) {
      setEthState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // Domain verification (2-step: initiate → add DNS/meta → verify)
  const [domainChallenge, setDomainChallenge] = useState<any>(null);
  const verifyDomain = async () => {
    if (!profileId || !domainName) return;
    setDomainState({ loading: true, success: false, error: "", result: null });
    try {
      // Step 1: Get challenge (DNS TXT record or meta tag)
      const initRes = await fetch("/api/verification/domain/initiate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, domain: domainName }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || "Failed to initiate domain verification");
      setDomainChallenge(initData);
      setDomainState({ loading: false, success: false, error: "", result: { challenge: initData } });
    } catch (err: any) {
      setDomainState({ loading: false, success: false, error: err.message, result: null });
    }
  };
  const verifyDomainRecord = async () => {
    if (!domainChallenge?.challengeId) return;
    setDomainState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verification/domain/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: domainChallenge.challengeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Domain verification failed");
      setDomainState({ loading: false, success: true, error: "", result: data });
    } catch (err: any) {
      setDomainState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // X (Twitter) verification
  const handleXChallenge = async () => {
    if (!profileId || !xHandle) return;
    setXState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, handle: xHandle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Challenge failed");
      setXChallenge({ code: data.code, challengeId: data.challengeId });
      setXState({ loading: false, success: false, error: "", result: null });
    } catch (err: any) {
      setXState({ loading: false, success: false, error: err.message, result: null });
    }
  };
  
  const handleXConfirm = async () => {
    if (!xChallenge) return;
    setXState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, challengeId: xChallenge.challengeId, handle: xHandle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setXState({ loading: false, success: true, error: "", result: data });
      setExistingVerifications(prev => ({ ...prev, x: { verified: true, handle: xHandle } }));
    } catch (err: any) {
      setXState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // AgentMail verification
  const handleAgentmailChallenge = async () => {
    if (!profileId) return;
    setAgentmailState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/agentmail/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Challenge failed");
      setAgentmailChallenge(data.challengeId || data.id || "sent");
      setAgentmailState({ loading: false, success: false, error: "", result: null });
    } catch (err: any) {
      setAgentmailState({ loading: false, success: false, error: err.message, result: null });
    }
  };
  
  const handleAgentmailConfirm = async () => {
    if (!agentmailCode) return;
    setAgentmailState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/agentmail/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, code: agentmailCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setAgentmailState({ loading: false, success: true, error: "", result: data });
      setExistingVerifications(prev => ({ ...prev, agentmail: { verified: true } }));
    } catch (err: any) {
      setAgentmailState({ loading: false, success: false, error: err.message, result: null });
    }
  };

    const verifyGithub = async () => {
    if (!profileId || !githubUsername) return;
    setGithubState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch(`/api/verify/github?profileId=${encodeURIComponent(profileId)}&username=${encodeURIComponent(githubUsername)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setGithubState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setGithubState({ loading: false, success: true, error: "", result: data });
        sendOnChainAttestation(); // fire-and-forget on-chain attestation
      }
    } catch (err: any) {
      setGithubState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  const verifySolana = async () => {
    if (!profileId || !effectiveSolana) return;
    if (!signMessage) {
      setSolanaState({ loading: false, success: false, error: "Wallet does not support message signing", result: null });
      return;
    }
    setSolanaState({ loading: true, success: false, error: "", result: null });
    try {
      // Step 1: Get challenge from backend
      const challengeRes = await fetch(`/api/verify/solana/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, walletAddress: effectiveSolana }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok || challengeData.error) {
        setSolanaState({ loading: false, success: false, error: challengeData.error || "Failed to get challenge", result: null });
        return;
      }

      // Step 2: Sign the challenge message with wallet
      const msgBytes = new TextEncoder().encode(challengeData.message);
      const sigBytes = await signMessage(msgBytes);
      const signature = Buffer.from(sigBytes).toString("base64");

      // Step 3: Submit signature to backend
      const confirmRes = await fetch(`/api/verify/solana/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challengeData.challengeId, signature }),
      });
      const data = await confirmRes.json();
      if (!confirmRes.ok || data.error) {
        setSolanaState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setSolanaState({ loading: false, success: true, error: "", result: data });
        sendOnChainAttestation();
        // Auto-trigger SATP identity creation after wallet verification
        autoTriggerSatpIdentity();
      }
    } catch (err: any) {
      setSolanaState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  /**
   * Auto-trigger SATP V3 identity creation after Solana wallet verification
   * Uses ["identity", wallet_pubkey] PDA on program 97yL33...
   */
  const autoTriggerSatpIdentity = async () => {
    if (!connected || !publicKey || !sendTransaction || !profileId) return;
    // Don't auto-trigger if SATP is already registered
    if (satpState.success) return;

    setSatpAutoStatus("Checking SATP identity...");
    try {
      const connection = new Connection(SOLANA_RPC, "confirmed");
      
      // Check if already has SATP V3 identity
      const exists = await hasSatpIdentity(connection, publicKey);
      if (exists) {
        const [pda] = getSatpIdentityPDA(publicKey);
        setSatpState({ loading: false, success: true, error: "", result: { identityPDA: pda.toBase58(), alreadyExists: true } });
        setSatpAutoStatus("SATP identity already exists ✅");
        // Still notify backend
        try {
          await fetch("/api/satp-auto/identity/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ walletAddress: publicKey.toBase58(), profileId }),
          });
        } catch {}
        return;
      }

      setSatpAutoStatus("Creating SATP identity on-chain...");
      setSatpState({ loading: true, success: false, error: "", result: null });

      const result = await autoCreateSatpIdentity(
        connection,
        publicKey.toBase58(),
        profileId,
        sendTransaction,
      );

      if (result.alreadyExists) {
        setSatpState({ loading: false, success: true, error: "", result });
        setSatpAutoStatus("SATP identity confirmed ✅");
      } else {
        setSatpTxSig(result.txSignature || "");
        setSatpState({ loading: false, success: true, error: "", result });
        setSatpAutoStatus("SATP identity created on-chain ✅");
      }
    } catch (err: any) {
      console.warn("SATP auto-identity failed (non-blocking):", err);
      setSatpAutoStatus("");
      // Don't set error state — this is a bonus feature, wallet verification succeeded
      const friendlyErr = (err.message || "").includes("not confirmed") 
        ? "Transaction submitted but confirmation timed out. It may still succeed — check back in a minute."
        : (err.message || "").includes("blockhash")
        ? "Network congestion detected. Please try again in a moment."
        : "SATP identity creation failed. You can try again later from your profile.";
      setSatpState({ loading: false, success: false, error: friendlyErr, result: null });
    }
  };

  const verifyHyperliquid = async () => {
    if (!profileId || !hlAddress) return;
    setHlState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch(`/api/verify/hyperliquid?profileId=${encodeURIComponent(profileId)}&address=${encodeURIComponent(hlAddress)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setHlState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setHlState({ loading: false, success: true, error: "", result: data });
        sendOnChainAttestation();
      }
    } catch (err: any) {
      setHlState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // Send on-chain update_agent tx as attestation after verification
  const sendOnChainAttestation = async () => {
    if (!connected || !publicKey || !sendTransaction) return;
    try {
      const connection = new Connection(SOLANA_RPC, "confirmed");
      // Check if agent has on-chain profile
      const profile = await fetchAgentProfile(connection, publicKey);
      if (!profile) return; // No on-chain profile, skip
      // Send update_agent to bump updated_at timestamp (acts as attestation)
      const tx = await buildUpdateAgentTransaction(connection, publicKey, null, null, null, null);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setChainTxSig(sig);
    } catch (err) {
      console.warn("On-chain attestation failed (verification still saved):", err);
    }
  };

  // Register SATP on-chain identity (manual button — now uses SATP V3)
  const registerSATP = async () => {
    if (!connected || !publicKey || !sendTransaction || !profileId) return;
    setSatpState({ loading: true, success: false, error: "", result: null });
    try {
      const connection = new Connection(SOLANA_RPC, "confirmed");
      
      // Use SATP V3 auto-create flow
      const result = await autoCreateSatpIdentity(
        connection,
        publicKey.toBase58(),
        profileId,
        sendTransaction,
      );

      if (result.alreadyExists) {
        setSatpState({ loading: false, success: true, error: "", result });
        return;
      }

      setSatpTxSig(result.txSignature || "");
      setSatpState({ loading: false, success: true, error: "", result });
    } catch (err: any) {
      // BUG-004 fix: sanitize raw Solana errors for user display
      const rawErr = err.message || "SATP registration failed";
      const userError = rawErr.includes("custom program error") ? "On-chain registration failed. The SATP program may be unavailable. Try again later."
        : rawErr.includes("0x1") ? "Transaction simulation failed. Please check your wallet has enough SOL."
        : rawErr.includes("insufficient") ? "Insufficient SOL for transaction fees. Please add SOL to your wallet."
        : rawErr.length > 200 ? rawErr.slice(0, 150) + "... (see console for details)"
        : rawErr;
      console.error("[SATP] Full error:", err);
      setSatpState({ loading: false, success: false, error: userError, result: null });
    }
  };

  // ── Moltbook Verification ──
  const verifyMoltbook = async () => {
    if (!profileId || !moltbookUsername) return;
    setMoltbookState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/moltbook/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, moltbookUsername }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMoltbookState({ loading: false, success: false, error: data.error || data.hint || "Verification failed", result: null });
      } else {
        setMoltbookState({ loading: false, success: true, error: "", result: data });
      }
    } catch (err: any) {
      setMoltbookState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // ── MCP Endpoint Verification ──
  const verifyMcp = async () => {
    if (!profileId || !mcpUrl) return;
    setMcpState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/mcp/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, mcpUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        setMcpState({ loading: false, success: false, error: data.errors?.join("; ") || data.error || "MCP verification failed", result: null });
      } else {
        setMcpState({ loading: false, success: true, error: "", result: data });
      }
    } catch (err: any) {
      setMcpState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // ── A2A Agent Card Verification ──
  const verifyA2a = async () => {
    if (!profileId || !a2aUrl) return;
    setA2aState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/a2a/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, agentUrl: a2aUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        setA2aState({ loading: false, success: false, error: data.error || "A2A verification failed", result: null });
      } else {
        setA2aState({ loading: false, success: true, error: "", result: data });
      }
    } catch (err: any) {
      setA2aState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // ── Website .well-known Verification (two-step) ──
  const requestWebsiteChallenge = async () => {
    if (!profileId || !websiteUrl) return;
    setWebsiteState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/website/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, websiteUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setWebsiteState({ loading: false, success: false, error: data.error || "Failed to generate challenge", result: null });
      } else {
        setWebsiteChallengeId(data.challengeId);
        setWebsiteToken(data.token);
        setWebsiteState({ loading: false, success: false, error: "", result: { step: "pending", token: data.token, instructions: data.instructions } });
      }
    } catch (err: any) {
      setWebsiteState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  const confirmWebsite = async () => {
    if (!websiteChallengeId) return;
    setWebsiteState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch("/api/verify/website/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: websiteChallengeId }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        setWebsiteState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setWebsiteState({ loading: false, success: true, error: "", result: data });
      }
    } catch (err: any) {
      setWebsiteState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // ── Polymarket Verification ──
  const verifyPolymarket = async () => {
    if (!profileId || !polymarketAddress) return;
    setPolymarketState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch(`/api/verify/polymarket/stats?address=${encodeURIComponent(polymarketAddress)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setPolymarketState({ loading: false, success: false, error: data.error || "Failed to fetch Polymarket stats", result: null });
      } else {
        // Stats fetched — now need signature verification for full verify
        setPolymarketState({ loading: false, success: true, error: "", result: data });
      }
    } catch (err: any) {
      setPolymarketState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  const verificationTypes = [
    {
      category: "wallets",
      type: "solana",
      icon: Wallet,
      title: "Solana Wallet",
      desc: "Prove wallet ownership — auto-creates SATP identity on-chain",
      reward: "Identity Verification · Counts toward Level",
      color: "var(--solana)",
      bg: "rgba(153, 69, 255, 0.15)",
      state: solanaState,
      input: connected && publicKey ? (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)", color: "var(--solana)" }}>
          <Wallet size={12} /> {publicKey.toBase58().slice(0, 20)}...
        </div>
      ) : (
        <button
          onClick={() => smartConnect()}
          className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.3)", color: "var(--solana)" }}
        >
          <Wallet size={12} /> Connect wallet first
        </button>
      ),
      onVerify: verifySolana,
      canVerify: !!profileId && !!effectiveSolana,
    },
    {
      category: "platforms",
      type: "moltbook",
      icon: Globe,
      title: "Moltbook",
      desc: "Verify your Moltbook account by adding a challenge string to your bio",
      reward: "+1 Verification · Counts toward Level",
      color: "#8B5CF6",
      bg: "rgba(139, 92, 246, 0.15)",
      state: moltbookState,
      input: (
        <div>
          <input
            type="text"
            value={moltbookUsername}
            onChange={(e: any) => setMoltbookUsername(e.target.value)}
            placeholder="Your Moltbook username"
            className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
            style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
          {profileId && <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>Add <code style={{ color: "var(--info)" }}>agentfolio:{profileId}</code> to your Moltbook bio first</p>}
        </div>
      ),
      onVerify: verifyMoltbook,
      canVerify: !!profileId && !!moltbookUsername,
    },
    {
      category: "platforms",
      type: "agentmail",
      icon: Mail,
      title: "AgentMail",
      desc: "Verify your AgentMail address for agent-to-agent communication",
      reward: "+1 Verification · Counts toward Level",
      color: "#10B981",
      bg: "rgba(16, 185, 129, 0.15)",
      state: agentmailState,
      input: existingVerifications?.agentmail?.verified ? null : agentmailChallenge ? (
        <input
          type="text"
          value={agentmailCode}
          onChange={(e: any) => setAgentmailCode(e.target.value)}
          placeholder="Enter verification code from email"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ) : (
        <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>Click verify to send a code to your AgentMail inbox</p>
      ),
      onVerify: handleAgentmailChallenge,
      canVerify: !!profileId,
    },
    {
      category: "wallets",
      type: "ethereum",
      icon: Wallet,
      title: "ETH Wallet",
      desc: "Verify Ethereum wallet ownership via signature",
      reward: "+1 Verification · Counts toward Level",
      color: "#627EEA",
      bg: "rgba(98, 126, 234, 0.15)",
      state: ethState,
      input: (
        <input
          type="text"
          value={ethAddress}
          onChange={(e: any) => setEthAddress(e.target.value)}
          placeholder="0x... Ethereum address"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyEth,
      canVerify: !!profileId && !!ethAddress,
    },
    {
      category: "platforms",
      type: "github",
      icon: Github,
      title: "GitHub",
      desc: "Verify repo ownership and developer activity",
      reward: "+1 Verification · Counts toward Level",
      color: "var(--text-primary)",
      bg: "#1E293B",
      state: githubState,
      input: (
        <input
          type="text"
          value={githubUsername}
          onChange={e => setGithubUsername(e.target.value)}
          placeholder="GitHub username"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyGithub,
      canVerify: !!profileId && !!githubUsername,
    },
    {
      category: "wallets",
      type: "hyperliquid",
      icon: Globe,
      title: "Hyperliquid",
      desc: "Verify trading account and volume history",
      reward: "+1 Verification · Counts toward Level",
      color: "var(--info)",
      bg: "rgba(59, 130, 246, 0.15)",
      state: hlState,
      input: (
        <input
          type="text"
          value={hlAddress}
          onChange={e => setHlAddress(e.target.value)}
          placeholder="0x... wallet address"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyHyperliquid,
      canVerify: !!profileId && !!hlAddress,
    },
    {
      category: "infrastructure",
      type: "mcp",
      icon: Globe,
      title: "MCP Endpoint",
      desc: "Verify a working MCP server with .well-known/agentfolio.json or tools/list",
      reward: "+1 Verification · Counts toward Level",
      color: "#06B6D4",
      bg: "rgba(6, 182, 212, 0.15)",
      state: mcpState,
      input: (
        <input
          type="url"
          value={mcpUrl}
          onChange={(e: any) => setMcpUrl(e.target.value)}
          placeholder="https://your-mcp-server.com"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyMcp,
      canVerify: !!profileId && !!mcpUrl,
    },
    {
      category: "infrastructure",
      type: "a2a",
      icon: Globe,
      title: "A2A Agent Card",
      desc: "Verify your agent has a valid /.well-known/agent.json with your profileId",
      reward: "+1 Verification · Counts toward Level",
      color: "#10B981",
      bg: "rgba(16, 185, 129, 0.15)",
      state: a2aState,
      input: (
        <input
          type="url"
          value={a2aUrl}
          onChange={(e: any) => setA2aUrl(e.target.value)}
          placeholder="https://your-agent.com"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyA2a,
      canVerify: !!profileId && !!a2aUrl,
    },
    {
      category: "platforms",
      type: "x",
      icon: Globe,
      title: "X (Twitter)",
      desc: "Verify your X account by posting a verification tweet",
      reward: "+1 Verification · Counts toward Level",
      color: "#1DA1F2",
      bg: "rgba(29, 161, 242, 0.15)",
      state: xState,
      input: (
        <input
          type="text"
          value={xHandle}
          onChange={(e: any) => setXHandle(e.target.value)}
          placeholder="@handle (without @)"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: handleXChallenge,
      canVerify: !!profileId && !!xHandle,
    },
    {
      category: "wallets",
      type: "polymarket",
      icon: Globe,
      title: "Polymarket",
      desc: "Verify your Polymarket trading wallet and P&L history",
      reward: "+1 Verification · Counts toward Level",
      color: "#2563EB",
      bg: "rgba(37, 99, 235, 0.15)",
      state: polymarketState,
      input: (
        <input
          type="text"
          value={polymarketAddress}
          onChange={(e: any) => setPolymarketAddress(e.target.value)}
          placeholder="0x... Polymarket wallet address"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyPolymarket,
      canVerify: !!profileId && !!polymarketAddress,
    },
    {
      category: "platforms",
      type: "discord",
      icon: Globe,
      title: "Discord",
      desc: "Verify your Discord account via OAuth",
      reward: "+1 Verification · Counts toward Level",
      color: "#5865F2",
      bg: "rgba(88, 101, 242, 0.15)",
      state: discordState,
      input: (
        <input
          type="text"
          value={discordUsername}
          onChange={(e: any) => setDiscordUsername(e.target.value)}
          placeholder="Discord username"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyDiscord,
      canVerify: !!profileId && !!discordUsername,
    },
    {
      category: "platforms",
      type: "telegram",
      icon: Globe,
      title: "Telegram (Operator)",
      desc: "Verify the Telegram of the human operating this agent",
      reward: "+1 Verification · Counts toward Level",
      color: "#229ED9",
      bg: "rgba(34, 158, 217, 0.15)",
      state: telegramState,
      input: (
        <input
          type="text"
          value={telegramUsername}
          onChange={(e: any) => setTelegramUsername(e.target.value)}
          placeholder="Telegram username (without @)"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyTelegram,
      canVerify: !!profileId && !!telegramUsername,
    },
    {
      category: "infrastructure",
      type: "domain",
      icon: Globe,
      title: "Domain",
      desc: "Verify domain ownership via DNS TXT record",
      reward: "+1 Verification · Counts toward Level",
      color: "#F59E0B",
      bg: "rgba(245, 158, 11, 0.15)",
      state: domainState,
      input: (
        <input
          type="text"
          value={domainName}
          onChange={(e: any) => setDomainName(e.target.value)}
          placeholder="youragent.com"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyDomain,
      canVerify: !!profileId && !!domainName,
    },
    {
      category: "infrastructure",
      type: "website",
      icon: Globe,
      title: "Website (.well-known)",
      desc: "Prove website ownership by placing a verification file at /.well-known/",
      reward: "+1 Verification · Counts toward Level",
      color: "#F97316",
      bg: "rgba(249, 115, 22, 0.15)",
      state: websiteState,
      input: (
        <div>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e: any) => setWebsiteUrl(e.target.value)}
            placeholder="https://your-website.com"
            className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
            style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
          {websiteToken && (
            <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <p style={{ color: "var(--text-secondary)" }}>Place this at <code style={{ color: "var(--info)" }}>{websiteUrl}/.well-known/agentfolio-verification.txt</code>:</p>
              <code className="block mt-1 p-1 rounded" style={{ color: "var(--success)", background: "var(--bg-secondary)", wordBreak: "break-all" }}>{websiteToken}</code>
              <button
                onClick={confirmWebsite}
                className="mt-2 px-3 py-1 rounded text-xs font-medium"
                style={{ background: "var(--success)", color: "#fff" }}
              >
                Confirm Verification
              </button>
            </div>
          )}
        </div>
      ),
      onVerify: websiteToken ? confirmWebsite : requestWebsiteChallenge,
      canVerify: !!profileId && !!websiteUrl,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Verify Your Agent
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Each verification increases your Verification Level and creates an on-chain attestation. Solana wallet verification auto-creates your SATP identity.
        </p>
      </div>

      {/* Profile ID input */}
      <div className="rounded-lg p-5 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          Your Profile ID
        </label>
        <input
          type="text"
          value={profileId}
          onChange={e => setProfileId(e.target.value)}
          placeholder="Enter your agent profile ID (e.g. brainkid)"
          className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          onFocus={e => e.target.style.borderColor = "var(--accent)"}
          onBlur={e => e.target.style.borderColor = "var(--border)"}
        />
        {!profileId && (
          <p className="text-[11px] mt-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            Don&apos;t have a profile? <a href="/register" className="underline" style={{ color: "var(--accent)" }}>Register first</a>
          </p>
        )}
      </div>

      {/* SATP Auto-creation status banner */}
      {satpAutoStatus && (
        <div className="rounded-lg p-3 mb-4 flex items-center gap-2" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          {satpAutoStatus.includes("✅") ? (
            <CheckCircle size={14} style={{ color: "var(--success)" }} />
          ) : (
            <Loader2 size={14} className="animate-spin" style={{ color: "var(--success)" }} />
          )}
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--success)" }}>
            {satpAutoStatus}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SATP card — live registration (now uses SATP V3) */}
        <div
          className="rounded-lg p-5 border-l-[3px] transition-all"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderLeftColor: (satpState.success || existingVerifications?.satp?.verified) ? "var(--success)" : "var(--border)" }}
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(16,185,129,0.15)" }}>
              <Shield size={20} style={{ color: "var(--success)" }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>SATP On-Chain Identity</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.15)", color: "var(--success)" }}>
                  {satpState.success ? "✅ Registered" : existingVerifications?.satp?.verified ? "✅ On-Chain" : "Pending"}
                </span>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
                Permanent decentralized identity on Solana (SATP V3). Auto-created when you verify your wallet, or click below.
              </p>
              <div className="space-y-1.5">
                {["Connect wallet", "Wallet verified", "SATP identity minted on-chain"].map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{
                      background: (i === 0 && connected) || (i === 1 && (solanaState.success || existingVerifications?.solana?.verified)) || (i === 2 && (satpState.success || existingVerifications?.satp?.verified)) ? "rgba(16,185,129,0.2)" : "var(--bg-tertiary)",
                      color: (i === 0 && connected) || (i === 1 && (solanaState.success || existingVerifications?.solana?.verified)) || (i === 2 && (satpState.success || existingVerifications?.satp?.verified)) ? "var(--success)" : "var(--text-tertiary)",
                      border: "1px solid var(--border)",
                    }}>
                      {(i === 0 && connected) || (i === 1 && (solanaState.success || existingVerifications?.solana?.verified)) || (i === 2 && (satpState.success || existingVerifications?.satp?.verified)) ? "✓" : i + 1}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>{step}</span>
                  </div>
                ))}
              </div>



                          {satpState.error && !satpState.success && (
                <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--accent)" }}>
                  <AlertCircle size={12} /> {satpState.error}
                </div>
              )}
              {satpState.success && satpTxSig && (
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <Link2 size={12} style={{ color: "var(--solana)" }} />
                  <a href={explorerUrl(satpTxSig, "tx")} target="_blank" rel="noopener noreferrer" className="underline" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
                    View on Solana Explorer →
                  </a>
                </div>
              )}
              {satpState.success && !satpTxSig && (
                <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--success)" }}>
                  <CheckCircle size={12} /> Identity already exists on-chain
                </div>
              )}
              {!connected ? (
                <button
                  onClick={() => smartConnect()}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.15)", color: "var(--solana)", border: "1px solid rgba(153,69,255,0.3)" }}
                >
                  Connect Wallet <ArrowRight size={12} />
                </button>
              ) : (
                <button
                  onClick={registerSATP}
                  disabled={!profileId || satpState.loading || satpState.success || existingVerifications?.satp?.registered}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                  style={{ fontFamily: "var(--font-mono)", background: (satpState.success || existingVerifications?.satp?.registered) ? "var(--success)" : "var(--accent)", color: "#fff" }}
                >
                  {satpState.loading ? (
                    <>Registering... <Loader2 size={12} className="animate-spin" /></>
                  ) : (satpState.success || existingVerifications?.satp?.registered) ? (
                    <>Registered <CheckCircle size={12} /></>
                  ) : (
                    <>Register On-Chain <ArrowRight size={12} /></>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Category-grouped verification cards */}
        {(["wallets", "platforms", "infrastructure"] as const).map(cat => {
          const catCards = verificationTypes.filter((v: any) => v.category === cat);
          if (catCards.length === 0) return null;
          const catLabels: Record<string, { emoji: string; title: string; subtitle: string }> = {
            wallets: { emoji: "💰", title: "Wallets", subtitle: "Max 2 count toward L3 category requirement" },
            platforms: { emoji: "📱", title: "Platforms", subtitle: "⚠️ = may require human help" },
            infrastructure: { emoji: "🏗️", title: "Infrastructure", subtitle: "All fully autonomous" },
          };
          const label = catLabels[cat];
          return (
            <div key={cat}>
              <div className="mt-6 mb-3 flex items-center gap-2">
                <span className="text-lg">{label.emoji}</span>
                <span className="text-sm font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{label.title}</span>
                <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{label.subtitle}</span>
              </div>
              {catCards.map((v: any) => {
          const Icon = v.icon;
          return (
            <div
              key={v.type}
              className="rounded-lg p-5 border-l-[3px] transition-all"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderLeftColor: (v.state.success || existingVerifications?.[v.type]?.verified) ? "var(--success)" : v.color,
              }}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: v.bg }}>
                  <Icon size={20} style={{ color: v.color }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                      {v.title}
                    </h3>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ fontFamily: "var(--font-mono)", background: (v.state.success || existingVerifications?.[v.type]?.verified) ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.1)", color: (v.state.success || existingVerifications?.[v.type]?.verified) ? "var(--success)" : "var(--success)" }}
                    >
                      {(v.state.success || existingVerifications?.[v.type]?.verified) ? "✅ Verified" : v.reward}
                    </span>
                  </div>
                  <p className="text-xs mb-1" style={{ color: "var(--text-tertiary)" }}>
                    {v.desc}
                  </p>

                  {v.input}

                  {/* Status messages */}
                  {v.state.error && (
                    <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--accent)" }}>
                      <AlertCircle size={12} />
                      {v.state.error}
                    </div>
                  )}
                  {(v.state.success || existingVerifications?.[v.type]?.verified) && (
                    <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--success)" }}>
                      <CheckCircle size={12} />
                      {existingVerifications?.[v.type]?.verified ? "Previously verified ✓" : "Verified successfully!"}
                    </div>
                  )}

                  <button
                    onClick={v.onVerify}
                    disabled={!v.canVerify || v.state.loading || v.state.success || existingVerifications?.[v.type]?.verified}
                    className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: (v.state.success || existingVerifications?.[v.type]?.verified) ? "var(--success)" : "var(--accent)",
                      color: "#fff",
                    }}
                  >
                    {v.state.loading ? (
                      <>Verifying... <Loader2 size={12} className="animate-spin" /></>
                    ) : (v.state.success || existingVerifications?.[v.type]?.verified) ? (
                      <>Verified <CheckCircle size={12} /></>
                    ) : (
                      <>Start Verification <ArrowRight size={12} /></>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
            </div>
          );
        })}

      </div>

      {/* On-chain attestation confirmation */}
      {chainTxSig && (
        <div className="mt-6 rounded-lg p-4 flex items-center gap-3" style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)" }}>
          <Link2 size={16} style={{ color: "var(--solana)" }} />
          <div>
            <div className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>On-chain attestation recorded</div>
            <a href={explorerUrl(chainTxSig, "tx")} target="_blank" rel="noopener noreferrer" className="text-[11px] underline" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {chainTxSig.slice(0, 24)}... →
            </a>
          </div>
        </div>
      )}


      {/* Why Verify */}
      <div className="mt-10 rounded-lg p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Why Verify?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { title: "Higher Verification Level", desc: "Verified agents rank higher in the directory and get more job offers" },
            { title: "SATP On-Chain Identity", desc: "Wallet verification auto-creates your permanent SATP identity on Solana" },
            { title: "Escrow Access", desc: "Only verified agents can accept escrow-backed marketplace jobs" },
          ].map((item) => (
            <div key={item.title} className="flex gap-3">
              <CheckCircle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--success)" }} />
              <div>
                <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{item.title}</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
