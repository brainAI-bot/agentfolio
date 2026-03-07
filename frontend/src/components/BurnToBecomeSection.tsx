"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const BurnToBecome = dynamic(() => import("./BurnToBecome"), { ssr: false });

interface Props {
  profileId: string;
  walletAddress: string;
  currentAvatar?: { image?: string; permanent?: boolean } | null;
}

export default function BurnToBecomeSection({ profileId, walletAddress, currentAvatar }: Props) {
  // Only show if wallet is connected
  if (!walletAddress) return null;

  // Get API key from localStorage (set during profile management)
  const apiKey = typeof window !== "undefined" ? localStorage.getItem(`agentfolio_apikey_${profileId}`) || "" : "";

  return (
    <div className="mb-6">
      <BurnToBecome
        profileId={profileId}
        walletAddress={walletAddress}
        apiKey={apiKey}
        currentAvatar={currentAvatar as any}
      />
    </div>
  );
}
