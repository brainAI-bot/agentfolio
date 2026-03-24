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
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:shadow-[0_0_20px_rgba(153,69,255,0.4)] animate-pulse"
        style={{
          fontFamily: "var(--font-mono)",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        <Shield size={14} />
        Claim This Profile
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
