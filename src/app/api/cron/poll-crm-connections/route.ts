/**
 * GET /api/cron/poll-crm-connections
 *
 * Vercel cron every 15 min. Walks every CrmOAuthConnection, fetches
 * deals updated since the connection's watermark, enqueues matching
 * ones (via stageRules) to PendingOfflineConversion. The actual
 * Google upload happens in `/api/cron/upload-offline-conversions`,
 * which runs on the same cadence.
 */
import { NextResponse } from "next/server";

import { pollAllConnections } from "@/lib/crm/poller";

export const maxDuration = 300;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured." },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }
  const t0 = Date.now();
  const results = await pollAllConnections();
  const totalEnqueued = results.reduce((s, r) => s + r.enqueued, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  return NextResponse.json({
    ok: totalErrors === 0,
    durationMs: Date.now() - t0,
    connectionsPolled: results.length,
    enqueued: totalEnqueued,
    perConnection: results,
  });
}
