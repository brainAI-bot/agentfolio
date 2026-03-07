"use client";

import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";

const DEMO_PUBLIC_KEY = new PublicKey("Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc");

export function useDemoMode() {
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setIsDemo(params.get("demo") === "1");
    }
  }, []);
  return { isDemo, demoPublicKey: DEMO_PUBLIC_KEY };
}
