/**
 * Serve asset bytes with the correct Content-Type so `<img>` tags
 * elsewhere in the app can reference `/api/assets/<id>/bytes`.
 *
 * Auth: same scoping rules as the assets list — caller must own the
 * asset (live) OR demo mode must be active (demo). Anything else 404s.
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  const demoMode = await getEffectiveDemoMode(session.user.role);

  const asset = await db.asset.findFirst({
    where: demoMode
      ? { id, demoMode: true }
      : { id, userId: session.user.id, demoMode: false },
    select: { mime: true, bytes: true },
  });
  if (!asset) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Convert Bytes (Uint8Array / Buffer) to BodyInit. Buffer works
  // directly; this is here so the type narrows cleanly.
  const body = Buffer.isBuffer(asset.bytes)
    ? asset.bytes
    : Buffer.from(asset.bytes);

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": asset.mime,
      // Same caller will hit the URL multiple times (thumbnail + detail);
      // private cache helps but never leaks across users.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
