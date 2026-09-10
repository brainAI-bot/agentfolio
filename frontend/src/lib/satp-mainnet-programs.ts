export const SATP_MAINNET_PROGRAMS = {
  IDENTITY: "GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG",
  REVIEWS: "r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4",
  REPUTATION: "2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ",
  ATTESTATIONS: "6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD",
  VALIDATION: "6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV",
  ESCROW: "HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C",
} as const;

export const SATP_MAINNET_REGISTRATION_PROGRAM_ID =
  "CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB";

export const SATP_V3_IDENTITY_PROGRAM_ID = SATP_MAINNET_PROGRAMS.IDENTITY;

export const SATP_DISPLAYED_MAINNET_PROGRAMS = [
  {
    key: "REGISTRATION_IDENTITY",
    name: "Live Registration Identity",
    id: SATP_MAINNET_REGISTRATION_PROGRAM_ID,
    provenance: "registration" as const,
  },
  ...Object.entries(SATP_MAINNET_PROGRAMS).map(([key, id]) => ({
    key,
    name: key === "IDENTITY" ? "V3 Identity Cluster" : key,
    id,
    provenance: "satp-v3" as const,
  })),
] as const;

export type SatpMainnetProgramName = keyof typeof SATP_MAINNET_PROGRAMS;
