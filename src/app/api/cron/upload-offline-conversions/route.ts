/**
 * GET /api/cron/upload-offline-conversions
 *
 * Vercel cron hits this every 15 minutes — picks up queued
 * `PendingOfflineConversion` rows (from CRM webhooks, CSV uploads,
 * GA4-offline) and ships them to Google in batches via
 * `ConversionUploadService.uploadClickConversions`.
 *
 * Auth: same `Bearer ${CRON_SECRET}` pattern as the other crons.
 */
import { NextResponse } from "next/server";

import { processAllPending } from "@/lib/google-ads/offline-uploads";

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
  const results = await processAllPending();
  const totalUploaded = results.reduce((s, r) => s + r.uploaded, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);

  return NextResponse.json({
    ok: totalFailed === 0,
    durationMs: Date.now() - t0,
    accountsTouched: results.length,
    uploaded: totalUploaded,
    failed: totalFailed,
    perAccount: results,
  });
}
