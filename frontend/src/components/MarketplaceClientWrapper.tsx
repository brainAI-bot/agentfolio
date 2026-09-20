"use client";

import { useEffect } from "react";
import { useWalletLoad } from "@/components/ClientProviders";
import { MarketplaceClient } from "@/components/MarketplaceClient";
import type { Job } from "@/lib/types";

export function MarketplaceClientWrapper({ jobs, total = jobs.length }: { jobs: Job[]; total?: number }) {
  const { loaded, triggerLoad } = useWalletLoad();

  useEffect(() => {
    if (!loaded) triggerLoad();
  }, [loaded, triggerLoad]);

  if (!loaded) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
        Loading marketplace...
      </div>
    );
  }

  return <MarketplaceClient jobs={jobs} total={total} />;
}
