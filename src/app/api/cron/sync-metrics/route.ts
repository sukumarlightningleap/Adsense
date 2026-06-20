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

import { optimizeAllConnectedAccounts } from "@/lib/google-ads/auto-optimize";
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
  // 1. Sync metrics — campaign + ad-group KPIs and conversion-action stats.
  const syncResults = await syncAllConnectedAccounts();
  // 2. Phase 10 — optimizer runs immediately after sync so it operates on
  //    the freshest 7d window. Accounts with optimizationMode='off' are
  //    skipped at the query layer; 'review_first' emits suggestions
  //    instead of mutating.
  const optimizeResults = await optimizeAllConnectedAccounts();

  const syncErrors = syncResults.reduce((s, r) => s + r.errors.length, 0);
  const optimizeErrors = optimizeResults.reduce(
    (s, r) => s + r.errors.length,
    0,
  );

  return NextResponse.json({
    ok: syncErrors + optimizeErrors === 0,
    accounts: syncResults.length,
    sync: {
      campaignKpiRows: syncResults.reduce((s, r) => s + r.campaignKpiRows, 0),
      adGroupKpiRows: syncResults.reduce((s, r) => s + r.adGroupKpiRows, 0),
      conversionActionsUpdated: syncResults.reduce(
        (s, r) => s + r.conversionActionsUpdated,
        0,
      ),
      errors: syncErrors,
    },
    optimize: {
      accounts: optimizeResults.length,
      actionsTaken: optimizeResults.reduce((s, r) => s + r.actionsTaken, 0),
      suggestionsEmitted: optimizeResults.reduce(
        (s, r) => s + r.suggestionsEmitted,
        0,
      ),
      errors: optimizeErrors,
    },
    perAccountSync: syncResults,
    perAccountOptimize: optimizeResults,
    durationMs: Date.now() - t0,
  });
}
