import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET || "agentfolio-revalidate-2026";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { secret, path, profileId } = body;

    if (secret !== REVALIDATE_SECRET) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    if (path) {
      revalidatePath(path);
    } else if (profileId) {
      revalidatePath("/profile/" + profileId);
      revalidatePath("/"); // also revalidate directory
    } else {
      return NextResponse.json({ error: "path or profileId required" }, { status: 400 });
    }

    return NextResponse.json({ revalidated: true, at: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
