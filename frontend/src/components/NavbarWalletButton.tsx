"use client";

import { NavbarWalletButtonActive, MobileWalletSectionActive } from "@/components/NavbarWalletButtonActive";

// Simple passthrough — wallet adapter is always loaded now.
// One click → modal opens. No lazy loading, no two-phase init.

export function NavbarWalletButton({ onProfileId }: { onProfileId?: (id: string | null) => void }) {
  return <NavbarWalletButtonActive onProfileId={onProfileId} />;
}

export function MobileWalletSection() {
  return <MobileWalletSectionActive />;
}
