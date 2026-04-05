"use client";
import { useEffect, useState } from "react";

/**
 * Client component that detects wallet connection and shows owner-specific actions.
 * Props:
 *   profileId - the profile ID
 *   profileWallet - the wallet address stored on the profile
 *   ownerContent - JSX to show when connected wallet = profile wallet
 *   visitorContent - JSX to show when not the owner (or no wallet connected)
 */
export function OwnerActions({
  profileId,
  profileWallet,
  ownerContent,
  visitorContent,
}: {
  profileId: string;
  profileWallet?: string;
  ownerContent: React.ReactNode;
  visitorContent: React.ReactNode;
}) {
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (!profileWallet) return;
    const check = () => {
      try {
        // Check Solana wallet adapter (standard)
        const phantom = (window as any).phantom?.solana;
        if (phantom?.isConnected && phantom?.publicKey) {
          setIsOwner(phantom.publicKey.toBase58() === profileWallet);
          return;
        }
        // Check solana-wallets-adapter state
        const solflare = (window as any).solflare;
        if (solflare?.isConnected && solflare?.publicKey) {
          setIsOwner(solflare.publicKey.toBase58() === profileWallet);
          return;
        }
      } catch {}
      setIsOwner(false);
    };
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, [profileWallet]);

  return <>{isOwner ? ownerContent : visitorContent}</>;
}
