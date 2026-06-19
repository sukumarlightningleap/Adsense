/**
 * Account health computation — what /app/accounts/[id]/health renders.
 *
 * Two health surfaces, both driven by data the daily sync writes:
 *
 *   1. CONVERSION-ACTION TRACKING HEALTH
 *      For each ConversionAction:
 *        ✓ working  — fired within last 7 days
 *        ⚠ stale    — last fire 7-30 days ago
 *        ✗ broken   — last fire >30 days ago, OR never (with spend > 0)
 *        ⚪ inactive — never fired AND account just imported (no judgement yet)
 *      This is Blue Balloon Books' broken-tracking case auto-flagged.
 *
 *   2. AD-GROUP BLEED SIGNALS
 *      For each AdGroup:
 *        🚨 bleeding — last 7d: spend > $50 AND zero conversions,
 *                      OR cpa_7d > 2 × campaign_cpa_7d
 *        ⚠ underperforming — cpa_7d between 1.5x and 2x campaign baseline
 *        ✓ ok       — everything else
 *      This is Ballast Books' bleeding-ad-group case auto-flagged.
 */
import { db } from "@/lib/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ConversionHealthStatus = "working" | "stale" | "broken" | "inactive";

export type ConversionHealthRow = {
  id: string;
  providerConversionId: string | null;
  name: string;
  category: string;
  status: string;
  isPrimary: boolean;
  lastConversionAt: Date | null;
  recentConversions: number | null;
  /** Days since the last fire (null if never fired). */
  daysSinceLastFire: number | null;
  health: ConversionHealthStatus;
  /** Human-readable explanation surfaced in the UI. */
  reason: string;
};

export type AdGroupBleedStatus = "bleeding" | "underperforming" | "ok" | "no_data";

export type AdGroupBleedRow = {
  id: string;
  name: string;
  themeLabel: string | null;
  campaignId: string;
  campaignName: string;
  spend7dUsd: number;
  conversions7d: number;
  cpa7dUsd: number | null;
  campaignCpa7dUsd: number | null;
  status: AdGroupBleedStatus;
  reason: string;
};

/**
 * Compute conversion-action health for an account.
 *
 * `referenceDate` defaults to now — pass a fixed Date in tests.
 */
export async function getConversionHealthForAccount(opts: {
  accountId: string;
  referenceDate?: Date;
}): Promise<ConversionHealthRow[]> {
  const now = opts.referenceDate ?? new Date();

  const account = await db.adsAccount.findFirst({
    where: { id: opts.accountId },
    select: { id: true, lastImportedAt: true },
  });
  if (!account) return [];

  const justImported =
    !account.lastImportedAt ||
    now.getTime() - account.lastImportedAt.getTime() < 2 * MS_PER_DAY;

  const actions = await db.conversionAction.findMany({
    where: { accountId: opts.accountId, status: { not: "REMOVED" } },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  });

  return actions.map((a) => {
    const daysSince =
      a.lastConversionAt != null
        ? Math.floor((now.getTime() - a.lastConversionAt.getTime()) / MS_PER_DAY)
        : null;

    let health: ConversionHealthStatus;
    let reason: string;
    if (daysSince == null) {
      if (justImported) {
        health = "inactive";
        reason = "No fires yet. Just imported — give the sync a day or two.";
      } else {
        health = "broken";
        reason = "No conversions ever recorded since import.";
      }
    } else if (daysSince <= 7) {
      health = "working";
      reason = `Last fired ${daysSince === 0 ? "today" : `${daysSince}d ago`}.${
        a.recentConversions != null
          ? ` ${a.recentConversions} total in last 30d.`
          : ""
      }`;
    } else if (daysSince <= 30) {
      health = "stale";
      reason = `Last fired ${daysSince}d ago. May indicate a degraded tag — check the snippet on the landing page.`;
    } else {
      health = "broken";
      reason = `Last fired ${daysSince}d ago. Tracking is almost certainly broken — repair below.`;
    }

    return {
      id: a.id,
      providerConversionId: a.providerConversionId,
      name: a.name,
      category: a.category,
      status: a.status,
      isPrimary: a.isPrimary,
      lastConversionAt: a.lastConversionAt,
      recentConversions: a.recentConversions,
      daysSinceLastFire: daysSince,
      health,
      reason,
    };
  });
}

/**
 * Compute ad-group bleed status for an account. Uses DailyAdGroupKpi
 * over the last 7 days vs the campaign-level baseline over the same window.
 */
export async function getAdGroupBleedForAccount(opts: {
  accountId: string;
  referenceDate?: Date;
}): Promise<AdGroupBleedRow[]> {
  const now = opts.referenceDate ?? new Date();
  const since = new Date(now.getTime() - 7 * MS_PER_DAY);

  // Pull ad groups + parent campaign, then their 7d KPIs in one go.
  const adGroups = await db.adGroup.findMany({
    where: {
      campaign: { accountId: opts.accountId },
      status: { not: "REMOVED" },
    },
    select: {
      id: true,
      name: true,
      themeLabel: true,
      campaign: { select: { id: true, name: true } },
    },
  });
  if (adGroups.length === 0) return [];

  const kpis = await db.dailyAdGroupKpi.findMany({
    where: {
      adGroupId: { in: adGroups.map((g) => g.id) },
      date: { gte: since },
    },
  });

  // Sum per ad group.
  const sums = new Map<
    string,
    { costMicros: bigint; conversions: number }
  >();
  for (const k of kpis) {
    const s = sums.get(k.adGroupId) ?? { costMicros: 0n, conversions: 0 };
    s.costMicros += k.costMicros;
    s.conversions += k.conversions;
    sums.set(k.adGroupId, s);
  }

  // Campaign-level CPA baseline.
  const campaignSums = new Map<
    string,
    { costMicros: bigint; conversions: number }
  >();
  for (const g of adGroups) {
    const s = sums.get(g.id);
    if (!s) continue;
    const cs = campaignSums.get(g.campaign.id) ?? {
      costMicros: 0n,
      conversions: 0,
    };
    cs.costMicros += s.costMicros;
    cs.conversions += s.conversions;
    campaignSums.set(g.campaign.id, cs);
  }

  const out: AdGroupBleedRow[] = adGroups.map((g) => {
    const s = sums.get(g.id) ?? { costMicros: 0n, conversions: 0 };
    const spendUsd = Number(s.costMicros) / 1_000_000;
    const conv = s.conversions;
    const cpa = conv > 0 ? spendUsd / conv : null;
    const baseline = campaignSums.get(g.campaign.id);
    const campCpa =
      baseline && baseline.conversions > 0
        ? Number(baseline.costMicros) / 1_000_000 / baseline.conversions
        : null;

    let status: AdGroupBleedStatus = "ok";
    let reason = `7d: $${spendUsd.toFixed(2)} spent · ${conv.toFixed(0)} conv`;

    if (spendUsd === 0) {
      status = "no_data";
      reason = "No spend in last 7d.";
    } else if (spendUsd > 50 && conv === 0) {
      status = "bleeding";
      reason = `$${spendUsd.toFixed(2)} spent · 0 conversions in 7d. Pause or rework copy.`;
    } else if (cpa != null && campCpa != null) {
      const ratio = cpa / campCpa;
      if (ratio >= 2) {
        status = "bleeding";
        reason = `CPA $${cpa.toFixed(2)} = ${ratio.toFixed(1)}× campaign avg ($${campCpa.toFixed(2)}). Bleeding.`;
      } else if (ratio >= 1.5) {
        status = "underperforming";
        reason = `CPA $${cpa.toFixed(2)} = ${ratio.toFixed(1)}× campaign avg ($${campCpa.toFixed(2)}). Worth attention.`;
      } else {
        reason = `CPA $${cpa.toFixed(2)} vs campaign $${campCpa.toFixed(2)}.`;
      }
    }

    return {
      id: g.id,
      name: g.name,
      themeLabel: g.themeLabel,
      campaignId: g.campaign.id,
      campaignName: g.campaign.name,
      spend7dUsd: spendUsd,
      conversions7d: conv,
      cpa7dUsd: cpa,
      campaignCpa7dUsd: campCpa,
      status,
      reason,
    };
  });

  // Sort bleeders first.
  const rank: Record<AdGroupBleedStatus, number> = {
    bleeding: 0,
    underperforming: 1,
    ok: 2,
    no_data: 3,
  };
  out.sort((a, b) => rank[a.status] - rank[b.status]);
  return out;
}
