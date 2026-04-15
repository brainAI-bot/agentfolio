export function extractProfileWallets(profile: any): string[] {
  if (!profile) return [];
  const candidates = new Set<string>();
  const add = (value: any) => {
    const normalized = String(value || '').trim();
    if (normalized) candidates.add(normalized);
  };

  const wallets = profile?.wallets;
  if (Array.isArray(wallets)) {
    for (const wallet of wallets) {
      add(wallet?.address);
    }
  } else if (wallets && typeof wallets === 'object') {
    add(wallets.solana);
    Object.values(wallets).forEach(add);
  }

  add(profile?.wallet);
  add(profile?.walletAddress);
  add(profile?.claimed_by);
  add(profile?.verification_data?.solana?.address);
  add(profile?.verification_data?.solana?.identifier);
  add(profile?.verifications?.solana?.address);
  add(profile?.verifications?.solana?.identifier);
  add(profile?.verificationData?.solana?.address);
  add(profile?.verificationData?.solana?.identifier);

  return Array.from(candidates);
}

export function profileHasWallet(profile: any, walletAddress: string | null | undefined): boolean {
  const target = String(walletAddress || '').trim().toLowerCase();
  if (!target) return false;
  return extractProfileWallets(profile).some((wallet) => String(wallet).trim().toLowerCase() === target);
}
