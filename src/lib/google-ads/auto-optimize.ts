/**
 * Phase 10 — daily optimization sweep.
 *
 * For every connected, non-manager account whose `optimizationMode` is
 * not 'off':
 *
 *   1. Read bleed signals from `health.ts` (uses the DailyAdGroupKpi
 *      rolling 7d window the cron just populated).
 *   2. For each `bleeding` ad group:
 *        - mode='auto'         → pause the ad group via Google Ads API
 *                                + emit a "we just paused X" notification
 *        - mode='review_first' → emit a "we'd suggest pausing X" notification
 *                                (do NOT touch Google)
 *   3. Audit-log every action / suggestion.
 *
 * Designed to be safe to re-run intra-day — we de-dupe by checking
 * whether a notification of the same kind has fired in the last 24h
 * for the same ad group. Prevents alert spam if the cron fires twice.
 */
import { db } from "@/lib/db";

import { getAdGroupBleedForAccount } from "./health";
import { setAdGroupStatus } from "./mutations";

import { emitNotification } from "@/lib/notifications/emit";

const DEDUPE_WINDOW_MS = 22 * 60 * 60 * 1000; // ~22h — re-fire is fine

export type OptimizeResult = {
  accountId: string;
  customerId: string;
  mode: "off" | "review_first" | "auto";
  actionsTaken: number;
  suggestionsEmitted: number;
  errors: string[];
};

export async function optimizeAllConnectedAccounts(): Promise<OptimizeResult[]> {
  const accounts = await db.adsAccount.findMany({
    where: {
      demoMode: false,
      oauthRefreshToken: { not: null },
      connectionStatus: "connected",
      isManager: false,
      // 'off' means skip entirely
      NOT: { optimizationMode: "off" },
    },
    select: {
      id: true,
      userId: true,
      customerId: true,
      optimizationMode: true,
      descriptiveName: true,
    },
  });
  const out: OptimizeResult[] = [];
  for (const account of accounts) {
    out.push(await optimizeAccount({ account }));
  }
  return out;
}

async function optimizeAccount(opts: {
  account: {
    id: string;
    userId: string;
    customerId: string;
    optimizationMode: string;
    descriptiveName: string | null;
  };
}): Promise<OptimizeResult> {
  const { account } = opts;
  const mode = account.optimizationMode as "auto" | "review_first";
  const result: OptimizeResult = {
    accountId: account.id,
    customerId: account.customerId,
    mode,
    actionsTaken: 0,
    suggestionsEmitted: 0,
    errors: [],
  };

  let bleeders;
  try {
    const all = await getAdGroupBleedForAccount({ accountId: account.id });
    bleeders = all.filter((r) => r.status === "bleeding");
  } catch (e) {
    result.errors.push(`bleed_read: ${errMsg(e)}`);
    return result;
  }

  if (bleeders.length === 0) return result;

  // Pull recent auto-optimizer notifications for these ad groups so we
  // don't re-fire within the dedupe window.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent = await db.notification.findMany({
    where: {
      userId: account.userId,
      kind: { in: ["auto_pause", "pause_suggestion"] },
      createdAt: { gte: since },
    },
    select: { payload: true },
  });
  const recentAdGroupIds = new Set<string>();
  for (const n of recent) {
    const adId = (n.payload as { adGroupId?: string } | null)?.adGroupId;
    if (adId) recentAdGroupIds.add(adId);
  }

  const accountLabel =
    account.descriptiveName ?? `Customer ${account.customerId}`;

  for (const b of bleeders) {
    if (recentAdGroupIds.has(b.id)) continue;

    if (mode === "auto") {
      const res = await setAdGroupStatus({
        adGroupId: b.id,
        newStatus: "PAUSED",
        auditAction: "ad_group.auto_pause",
        auditExtras: {
          source: "auto_optimize",
          spend7dUsd: b.spend7dUsd,
          conversions7d: b.conversions7d,
          cpa7dUsd: b.cpa7dUsd,
          campaignCpa7dUsd: b.campaignCpa7dUsd,
          reason: b.reason,
        },
      });
      if (res.ok) {
        await emitNotification({
          userId: account.userId,
          accountId: account.id,
          kind: "auto_pause",
          severity: "warning",
          title: `Auto-paused: ${b.name}`,
          body: [
            `Account: ${accountLabel}`,
            `Campaign: ${b.campaignName}`,
            ``,
            `Why we paused it: ${b.reason}`,
            ``,
            `7-day spend: $${b.spend7dUsd.toFixed(2)} · conversions: ${b.conversions7d.toFixed(0)}`,
            b.cpa7dUsd != null
              ? `CPA: $${b.cpa7dUsd.toFixed(2)} (vs campaign avg $${b.campaignCpa7dUsd?.toFixed(2) ?? "—"})`
              : ``,
            ``,
            `To re-enable: open the campaign in Adsense and click Enable on the ad group.`,
          ]
            .filter(Boolean)
            .join("\n"),
          payload: {
            adGroupId: b.id,
            campaignId: b.campaignId,
            spend7dUsd: b.spend7dUsd,
            conversions7d: b.conversions7d,
            cpa7dUsd: b.cpa7dUsd,
          },
        });
        result.actionsTaken += 1;
      } else {
        result.errors.push(`pause(${b.name}): ${res.error}`);
      }
    } else {
      // review_first — emit suggestion, don't touch Google
      await emitNotification({
        userId: account.userId,
        accountId: account.id,
        kind: "pause_suggestion",
        severity: "warning",
        title: `Suggestion: pause "${b.name}"`,
        body: [
          `Account: ${accountLabel}`,
          `Campaign: ${b.campaignName}`,
          ``,
          `Why: ${b.reason}`,
          ``,
          `7-day spend: $${b.spend7dUsd.toFixed(2)} · conversions: ${b.conversions7d.toFixed(0)}`,
          b.cpa7dUsd != null
            ? `CPA: $${b.cpa7dUsd.toFixed(2)} (vs campaign avg $${b.campaignCpa7dUsd?.toFixed(2) ?? "—"})`
            : ``,
          ``,
          `Open the campaign in Adsense and Pause this ad group, or switch optimization mode to "auto" in account settings to have us do it.`,
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          adGroupId: b.id,
          campaignId: b.campaignId,
          spend7dUsd: b.spend7dUsd,
          conversions7d: b.conversions7d,
          cpa7dUsd: b.cpa7dUsd,
        },
      });
      result.suggestionsEmitted += 1;
    }
  }

  return result;
}

function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}
