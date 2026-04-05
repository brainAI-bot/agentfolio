"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ClaimButton } from "./ClaimButton";

export function ProfileActions({ profileId, profileWallet, profileWallets, unclaimed }: { profileId: string; profileWallet?: string; profileWallets?: string[]; unclaimed?: boolean }) {
  const { publicKey, connected } = useWallet();
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const allWallets = new Set<string>();
    if (profileWallet) allWallets.add(profileWallet);
    if (profileWallets) profileWallets.forEach(w => { if (w) allWallets.add(w); });
    if (allWallets.size === 0) return;

    // Check wallet adapter first (most reliable)
    if (connected && publicKey) {
      const addr = publicKey.toBase58();
      if (allWallets.has(addr)) { setIsOwner(true); return; }
    }

    // Fallback: check raw window providers
    const check = () => {
      try {
        const providers = [
          (window as any).phantom?.solana,
          (window as any).solflare,
          (window as any).backpack?.solana,
        ];
        for (const p of providers) {
          if (p?.isConnected && p?.publicKey) {
            const addr = typeof p.publicKey === 'string' ? p.publicKey : p.publicKey.toBase58?.() || p.publicKey.toString?.();
            if (addr && allWallets.has(addr)) { setIsOwner(true); return; }
          }
        }
      } catch {}
    };
    check();
    const t1 = setTimeout(check, 500);
    const t2 = setTimeout(check, 1500);
    const t3 = setTimeout(check, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [profileWallet, profileWallets, connected, publicKey]);

  // Owner sees Edit Profile only
  if (isOwner) {
    return (
      <a href={`/profile/${profileId}/edit`}
        className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
        style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff", textDecoration: "none" }}>
        ✏️ Edit Profile
      </a>
    );
  }

  // Unclaimed = show claim button
  if (unclaimed) {
    return <ClaimButton profileId={profileId} profileName={profileId} />;
  }

  // Non-owner visitor with wallet connected: show Hire Agent
  if (connected && publicKey) {
    return (
      <a href="/marketplace"
        className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
        style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff", textDecoration: "none" }}>
        Hire Agent
      </a>
    );
  }

  // No wallet connected: no action button
  return null;
}
