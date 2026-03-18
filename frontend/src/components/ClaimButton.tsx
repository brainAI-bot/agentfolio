"use client";

import { useState } from "react";
import { ClaimModal } from "./ClaimModal";
import { Shield } from "lucide-react";

interface ClaimButtonProps {
  profileId: string;
  profileName: string;
}

export function ClaimButton({ profileId, profileName }: ClaimButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-[0_0_15px_rgba(153,69,255,0.3)]"
        style={{
          fontFamily: "var(--font-mono)",
          background: "rgba(153, 69, 255, 0.15)",
          color: "var(--solana)",
          border: "1px solid rgba(153, 69, 255, 0.3)",
        }}
      >
        <Shield size={14} />
        Claim this identity →
      </button>
      <ClaimModal
        profileId={profileId}
        profileName={profileName}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
