"use client";
import { useEffect, useState } from "react";

/**
 * Shows "Edit Profile" button when the connected wallet matches the profile's wallet.
 * Falls back to children (e.g., ClaimButton) when not the owner.
 */
export function OwnerActions({ profileId, profileWallet, children }: { profileId: string; profileWallet?: string; children?: React.ReactNode }) {
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (!profileWallet) return;
    // Check if the Solana wallet adapter has a matching connected wallet
    const checkWallet = () => {
      try {
        const phantom = (window as any).phantom?.solana;
        if (phantom?.isConnected && phantom?.publicKey) {
          setIsOwner(phantom.publicKey.toBase58() === profileWallet);
        }
      } catch {}
    };
    checkWallet();
    // Re-check on wallet events
    const interval = setInterval(checkWallet, 2000);
    return () => clearInterval(interval);
  }, [profileWallet]);

  if (isOwner) {
    return (
      <a
        href={`/profile/${profileId}/edit`}
        className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
        style={{ background: "var(--accent)", color: "#000" }}
      >
        ✏️ Edit Profile
      </a>
    );
  }

  return <>{children}</>;
}
