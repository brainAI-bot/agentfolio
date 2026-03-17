import { getAllJobs } from "@/lib/data";
import { MarketplaceClient } from "@/components/MarketplaceClient";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const jobs = await getAllJobs();
  return <MarketplaceClient jobs={jobs} />;
}
