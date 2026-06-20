/**
 * Daily metric + conversion-action sync.
 *
 * Pulls the last 7 days of metrics for every connected AdsAccount:
 *
 *   1. Campaign-level metrics  → upsert DailyKpi (idempotent on campaign+date)
 *   2. AdGroup-level metrics   → upsert DailyAdGroupKpi (NEW — bleed detection)
 *   3. ConversionAction stats  → update lastConversionAt + recentConversions
 *      on each ConversionAction so Phase 8b health checks (✓/⚠/✗) can run
 *      without re-querying Google.
 *
 * Run by the Vercel cron at /api/cron/sync-metrics. Designed to be safe
 * to re-run mid-day: every upsert keys on (resource, date) and overwrites.
 */
import { db } from "@/lib/db";

import { buildCustomerForAccount } from "./client";
import {
  detectAndEmitHealthTransitions,
  snapshotConversionHealth,
} from "./health-transitions";

type AdsCustomer = ReturnType<typeof buildCustomerForAccount>;

async function gaql<T>(customer: AdsCustomer, query: string): Promise<T[]> {
  return (await customer.query(query)) as unknown as T[];
}

export type SyncResult = {
  accountId: string;
  customerId: string;
  campaignKpiRows: number;
  adGroupKpiRows: number;
  conversionActionsUpdated: number;
  errors: string[];
  durationMs: number;
};

/**
 * Sync every connected account. Returns one result per account so the
 * cron handler can log + alert on per-account failures.
 */
export async function syncAllConnectedAccounts(): Promise<SyncResult[]> {
  const accounts = await db.adsAccount.findMany({
    where: {
      demoMode: false,
      oauthRefreshToken: { not: null },
      connectionStatus: "connected",
      // Skip manager accounts — Google rejects metric queries against
      // them ("Metrics cannot be requested for a manager account").
      // Their child sub-accounts are what we want to sync; they're
      // already separate AdsAccount rows.
      isManager: false,
    },
    select: {
      id: true,
      customerId: true,
      loginCustomerId: true,
      mccCustomerId: true,
      oauthRefreshToken: true,
    },
  });
  const results: SyncResult[] = [];
  for (const account of accounts) {
    try {
      const r = await syncAccount({ accountId: account.id });
      results.push(r);
    } catch (e) {
      results.push({
        accountId: account.id,
        customerId: account.customerId,
        campaignKpiRows: 0,
        adGroupKpiRows: 0,
        conversionActionsUpdated: 0,
        errors: [e instanceof Error ? e.message : String(e)],
        durationMs: 0,
      });
    }
  }
  return results;
}

/**
 * Sync a single account. Caller resolves the AdsAccount row from the DB
 * itself — we only need the ID here.
 */
export async function syncAccount(opts: {
  accountId: string;
}): Promise<SyncResult> {
  const t0 = Date.now();
  const account = await db.adsAccount.findFirst({
    where: { id: opts.accountId },
  });
  if (!account) throw new Error("Account not found.");

  const customer = buildCustomerForAccount(account);
  const errors: string[] = [];

  // --- Maps from provider IDs → our DB IDs --------------------------------
  // Needed because Google returns campaign/ad-group IDs and we store by cuid.
  const campaignIdMap = new Map<string, string>(); // providerCampaignId → our id
  const adGroupIdMap = new Map<string, string>();
  const convActionIdMap = new Map<string, string>();
  try {
    const camps = await db.campaign.findMany({
      where: { accountId: account.id, providerCampaignId: { not: null } },
      select: { id: true, providerCampaignId: true },
    });
    for (const c of camps)
      if (c.providerCampaignId) campaignIdMap.set(c.providerCampaignId, c.id);

    const groups = await db.adGroup.findMany({
      where: {
        campaign: { accountId: account.id },
        providerAdGroupId: { not: null },
      },
      select: { id: true, providerAdGroupId: true },
    });
    for (const g of groups)
      if (g.providerAdGroupId) adGroupIdMap.set(g.providerAdGroupId, g.id);

    const actions = await db.conversionAction.findMany({
      where: { accountId: account.id, providerConversionId: { not: null } },
      select: { id: true, providerConversionId: true },
    });
    for (const a of actions)
      if (a.providerConversionId)
        convActionIdMap.set(a.providerConversionId, a.id);
  } catch (e) {
    errors.push(`load_id_maps: ${errMsg(e)}`);
  }

  // --- 1. Campaign-level KPIs ---------------------------------------------
  let campaignKpiRows = 0;
  try {
    const rows = await gaql<CampaignMetricsRow>(
      customer,
      `
      SELECT
        campaign.id,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING LAST_7_DAYS
        AND campaign.status != 'REMOVED'
      `,
    );
    for (const r of rows) {
      const ourCampaignId = campaignIdMap.get(String(r.campaign.id));
      if (!ourCampaignId || !r.segments.date) continue;
      await db.dailyKpi.upsert({
        where: {
          uq_daily_kpi_campaign_date: {
            campaignId: ourCampaignId,
            date: new Date(r.segments.date),
          },
        },
        create: {
          campaignId: ourCampaignId,
          date: new Date(r.segments.date),
          impressions: BigInt(r.metrics.impressions ?? 0),
          clicks: BigInt(r.metrics.clicks ?? 0),
          costMicros: BigInt(r.metrics.cost_micros ?? 0),
          conversions: r.metrics.conversions ?? 0,
          conversionValueMicros: BigInt(
            Math.round((r.metrics.conversions_value ?? 0) * 1_000_000),
          ),
        },
        update: {
          impressions: BigInt(r.metrics.impressions ?? 0),
          clicks: BigInt(r.metrics.clicks ?? 0),
          costMicros: BigInt(r.metrics.cost_micros ?? 0),
          conversions: r.metrics.conversions ?? 0,
          conversionValueMicros: BigInt(
            Math.round((r.metrics.conversions_value ?? 0) * 1_000_000),
          ),
        },
      });
      campaignKpiRows += 1;
    }
  } catch (e) {
    errors.push(`campaign_kpis: ${errMsg(e)}`);
  }

  // --- 2. Ad-group-level KPIs (bleed detection foundation) ----------------
  let adGroupKpiRows = 0;
  try {
    const rows = await gaql<AdGroupMetricsRow>(
      customer,
      `
      SELECT
        ad_group.id,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group
      WHERE segments.date DURING LAST_7_DAYS
        AND ad_group.status != 'REMOVED'
      `,
    );
    for (const r of rows) {
      const ourAdGroupId = adGroupIdMap.get(String(r.ad_group.id));
      if (!ourAdGroupId || !r.segments.date) continue;
      await db.dailyAdGroupKpi.upsert({
        where: {
          uq_daily_ad_group_kpi_date: {
            adGroupId: ourAdGroupId,
            date: new Date(r.segments.date),
          },
        },
        create: {
          adGroupId: ourAdGroupId,
          date: new Date(r.segments.date),
          impressions: BigInt(r.metrics.impressions ?? 0),
          clicks: BigInt(r.metrics.clicks ?? 0),
          costMicros: BigInt(r.metrics.cost_micros ?? 0),
          conversions: r.metrics.conversions ?? 0,
          conversionValueMicros: BigInt(
            Math.round((r.metrics.conversions_value ?? 0) * 1_000_000),
          ),
        },
        update: {
          impressions: BigInt(r.metrics.impressions ?? 0),
          clicks: BigInt(r.metrics.clicks ?? 0),
          costMicros: BigInt(r.metrics.cost_micros ?? 0),
          conversions: r.metrics.conversions ?? 0,
          conversionValueMicros: BigInt(
            Math.round((r.metrics.conversions_value ?? 0) * 1_000_000),
          ),
        },
      });
      adGroupKpiRows += 1;
    }
  } catch (e) {
    errors.push(`ad_group_kpis: ${errMsg(e)}`);
  }

  // --- 3. Conversion-action freshness (Phase 8b health detection) --------
  //
  // We query last 30 days of conversion stats grouped by conversion_action
  // and update each ConversionAction row with:
  //   - lastConversionAt  = max(date) where all_conversions > 0
  //   - recentConversions = sum(all_conversions) over the window
  // Phase 8b then surfaces ✗ broken / ⚠ stale / ✓ working based on these.
  //
  // Phase B7: snapshot health BEFORE the update so we can detect
  // transitions (working→broken, etc.) and emit notifications below.
  const healthBefore = await snapshotConversionHealth(account.id).catch(
    () => new Map(),
  );
  let conversionActionsUpdated = 0;
  try {
    type ConvStatRow = {
      segments: {
        conversion_action?: string;
        date?: string;
      };
      metrics: {
        all_conversions?: number;
      };
    };
    const rows = await gaql<ConvStatRow>(
      customer,
      `
      SELECT
        segments.conversion_action,
        segments.date,
        metrics.all_conversions
      FROM customer
      WHERE segments.date DURING LAST_30_DAYS
      `,
    );
    // Aggregate per provider conversion action ID.
    type Bucket = { sum: number; lastDate: string | null };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      const ref = r.segments.conversion_action;
      if (!ref) continue;
      const providerId = extractId(ref, "conversionActions");
      const conv = r.metrics.all_conversions ?? 0;
      const date = r.segments.date ?? null;
      const b = buckets.get(providerId) ?? { sum: 0, lastDate: null };
      b.sum += conv;
      if (conv > 0 && date && (!b.lastDate || date > b.lastDate)) {
        b.lastDate = date;
      }
      buckets.set(providerId, b);
    }
    for (const [providerId, bucket] of buckets) {
      const ourId = convActionIdMap.get(providerId);
      if (!ourId) continue;
      await db.conversionAction.update({
        where: { id: ourId },
        data: {
          recentConversions: Math.round(bucket.sum),
          lastConversionAt: bucket.lastDate ? new Date(bucket.lastDate) : null,
        },
      });
      conversionActionsUpdated += 1;
    }
  } catch (e) {
    errors.push(`conversion_action_stats: ${errMsg(e)}`);
  }

  // Phase B7: compare new health vs the pre-sync snapshot and emit a
  // notification on every transition the customer cares about. Errors
  // here never block the sync — we just record them in the audit log.
  try {
    await detectAndEmitHealthTransitions({
      accountId: account.id,
      before: healthBefore,
    });
  } catch (e) {
    errors.push(`health_transitions: ${errMsg(e)}`);
  }

  // Audit log.
  await db.auditLog.create({
    data: {
      action: "ads_account.sync",
      targetKind: "ads_account",
      targetId: account.id,
      payload: {
        campaignKpiRows,
        adGroupKpiRows,
        conversionActionsUpdated,
        errorCount: errors.length,
        durationMs: Date.now() - t0,
      },
    },
  });

  return {
    accountId: account.id,
    customerId: account.customerId,
    campaignKpiRows,
    adGroupKpiRows,
    conversionActionsUpdated,
    errors,
    durationMs: Date.now() - t0,
  };
}

// ===========================================================================
// Row types for the metric queries
// ===========================================================================

type CampaignMetricsRow = {
  campaign: { id?: string };
  segments: { date?: string };
  metrics: {
    impressions?: string | number;
    clicks?: string | number;
    cost_micros?: string | number;
    conversions?: number;
    conversions_value?: number;
  };
};

type AdGroupMetricsRow = {
  ad_group: { id?: string };
  segments: { date?: string };
  metrics: {
    impressions?: string | number;
    clicks?: string | number;
    cost_micros?: string | number;
    conversions?: number;
    conversions_value?: number;
  };
};

function extractId(resourceName: string, collection: string): string {
  const re = new RegExp(`${collection}/([0-9]+)$`);
  const m = resourceName.match(re);
  return m?.[1] ?? resourceName;
}

function errMsg(e: unknown): string {
  // Google Ads SDK throws structured failures shaped roughly like:
  //   { errors: [{ message, error_code: {...}, trigger: {...} }],
  //     failure: {...}, request_id }
  // The default `String(e)` collapses these to "[object Object]" — we
  // dig out the useful bits so audit logs and cron responses surface
  // the real cause.
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    const errors = obj.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors
        .map((er) => {
          if (typeof er !== "object" || er === null) return String(er);
          const m = (er as { message?: unknown }).message;
          if (typeof m === "string" && m) return m;
          try {
            return JSON.stringify(er);
          } catch {
            return "[unserializable error]";
          }
        })
        .join("; ");
    }
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable error object]";
    }
  }
  return String(e);
}
