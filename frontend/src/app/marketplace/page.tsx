import { getAllJobs } from "@/lib/data";
import { MarketplaceClient } from "@/components/MarketplaceClient";

export const dynamic = "force-dynamic";

export default function MarketplacePage() {
  const jobs = getAllJobs();
  return <MarketplaceClient jobs={jobs} />;
}
