/**
 * GET /api/cron/sync-metrics
 *
 * Vercel cron hits this route once per day (schedule in vercel.json).
 * Pulls last-7d metrics for every connected account so the dashboard
 * stays fresh and the Phase 8b health checks have data to compute on.
 *
 * Auth: Vercel signs cron requests with the `CRON_SECRET` env var passed
 * via the `Authorization: Bearer ${CRON_SECRET}` header. We reject any
 * request without it — protects the endpoint from public abuse.
 */
import { NextResponse } from "next/server";

import { syncAllConnectedAccounts } from "@/lib/google-ads/sync";

// Long-running on accounts with many campaigns. Bump the function
// timeout — Vercel Pro allows up to 800s for cron functions.
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
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const t0 = Date.now();
  const results = await syncAllConnectedAccounts();
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  return NextResponse.json({
    ok: totalErrors === 0,
    accounts: results.length,
    totals: {
      campaignKpiRows: results.reduce((s, r) => s + r.campaignKpiRows, 0),
      adGroupKpiRows: results.reduce((s, r) => s + r.adGroupKpiRows, 0),
      conversionActionsUpdated: results.reduce(
        (s, r) => s + r.conversionActionsUpdated,
        0,
      ),
      errors: totalErrors,
    },
    perAccount: results,
    durationMs: Date.now() - t0,
  });
}
