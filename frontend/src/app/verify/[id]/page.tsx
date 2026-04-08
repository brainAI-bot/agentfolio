import { redirect } from "next/navigation";

export default async function VerifyByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/verify?profile=${encodeURIComponent(id)}`);
}
