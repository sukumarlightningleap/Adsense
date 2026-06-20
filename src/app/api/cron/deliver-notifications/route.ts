/**
 * GET /api/cron/deliver-notifications
 *
 * Vercel cron sweeps the queue every 15 minutes. Auth via the same
 * `CRON_SECRET` Bearer pattern as `/api/cron/sync-metrics`.
 */
import { NextResponse } from "next/server";

import { deliverPendingNotifications } from "@/lib/notifications/deliver";

export const maxDuration = 120;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured." },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  const t0 = Date.now();
  const result = await deliverPendingNotifications();
  return NextResponse.json({
    ok: result.failed === 0,
    ...result,
    durationMs: Date.now() - t0,
  });
}
