"use client";

import { createContext, useContext, useMemo, ReactNode, useState, useCallback, useEffect } from "react";
import { PublicKey, Transaction, VersionedTransaction, Connection } from "@solana/web3.js";
import { useSearchParams } from "next/navigation";
import { WalletProvider as RealWalletProvider } from "./WalletProvider";

// Mock wallet context that matches @solana/wallet-adapter-react interface
const DEMO_PUBKEY = new PublicKey("Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc");

interface MockWalletContextState {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  wallet: any;
  wallets: any[];
  select: (name: any) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendTransaction: (tx: Transaction | VersionedTransaction, connection: Connection) => Promise<string>;
  signTransaction: ((tx: Transaction) => Promise<Transaction>) | undefined;
  signAllTransactions: ((txs: Transaction[]) => Promise<Transaction[]>) | undefined;
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined;
}

const DemoWalletContext = createContext<MockWalletContextState | null>(null);

function DemoWalletInner({ children }: { children: ReactNode }) {
  const ctx: MockWalletContextState = {
    publicKey: DEMO_PUBKEY,
    connected: true,
    connecting: false,
    disconnecting: false,
    wallet: { adapter: { name: "Demo Wallet", icon: "", publicKey: DEMO_PUBKEY } },
    wallets: [],
    select: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendTransaction: async () => "DEMO_TX_" + Date.now().toString(36),
    signTransaction: async (tx: Transaction) => tx,
    signAllTransactions: async (txs: Transaction[]) => txs,
    signMessage: async (msg: Uint8Array) => msg,
  };

  return (
    <DemoWalletContext.Provider value={ctx}>
      {children}
    </DemoWalletContext.Provider>
  );
}

// Override the useWallet hook when in demo mode
export function SmartWalletProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "1";

  if (isDemo) {
    return <DemoWalletInner>{children}</DemoWalletInner>;
  }

  return <RealWalletProvider>{children}</RealWalletProvider>;
}

// Custom hook that checks demo context first
export function useDemoWallet() {
  return useContext(DemoWalletContext);
}
