/**
 * Dashboard query helpers.
 *
 * Every function takes `{ userId, demoMode }` so the caller (a Server
 * Component) is forced to pass through the effective mode. No globals,
 * no implicit scoping.
 *
 * Scoping rule (ported from launcher/db/repo.py):
 *   - demoMode=true:  filter on accounts.demoMode=true only
 *                     (org-wide demo dataset, every demo user sees the
 *                     same set, userId ignored)
 *   - demoMode=false: filter on accounts.userId=$userId AND demoMode=false
 *                     (live data, per-user isolation)
 */
import { db } from "@/lib/db";
import type { CampaignStatus, ChannelType } from "@/lib/ads/types";

export type WindowMetrics = {
  impressions: number;
  clicks: number;
  spendUsd: number;
  conversions: number;
};

export type KpiSummary = {
  current: WindowMetrics;
  prior: WindowMetrics;
  accountsInScope: number;
};

export type TrendPoint = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  clicks: number;
  spendUsd: number;
};

export type TopCampaign = {
  id: string;
  name: string;
  channelType: ChannelType;
  status: CampaignStatus;
  accountName: string;
  spendUsd: number;
  clicks: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function startOfUtcDay(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function microsToUsd(micros: bigint | number | null | undefined): number {
  if (micros == null) return 0;
  // Use string conversion to avoid precision loss on large bigints.
  const n = typeof micros === "bigint" ? Number(micros) : micros;
  return n / 1_000_000;
}

function bigIntToNumber(b: bigint | number | null | undefined): number {
  if (b == null) return 0;
  return typeof b === "bigint" ? Number(b) : b;
}

/**
 * Resolve which AdsAccount IDs are in scope for this caller. Empty array
 * means "nothing to query" — callers should short-circuit on this.
 */
async function accountIdsInScope(args: {
  userId: string;
  demoMode: boolean;
}): Promise<string[]> {
  const rows = await db.adsAccount.findMany({
    where: args.demoMode
      ? { demoMode: true }
      : { userId: args.userId, demoMode: false },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Current-period totals + prior-period totals for delta calculation.
 * Default window: 30 days, prior window: days 31–60 ago.
 */
export async function getKpiSummary(args: {
  userId: string;
  demoMode: boolean;
  windowDays?: number;
}): Promise<KpiSummary> {
  const { userId, demoMode, windowDays = 30 } = args;
  const accountIds = await accountIdsInScope({ userId, demoMode });

  if (accountIds.length === 0) {
    return {
      current: empty(),
      prior: empty(),
      accountsInScope: 0,
    };
  }

  const currentStart = startOfUtcDay(windowDays);
  const priorStart = startOfUtcDay(windowDays * 2);
  const priorEnd = currentStart; // exclusive — strictly less than

  const [current, prior] = await Promise.all([
    db.dailyKpi.aggregate({
      where: {
        campaign: { accountId: { in: accountIds } },
        date: { gte: currentStart },
      },
      _sum: {
        impressions: true,
        clicks: true,
        costMicros: true,
        conversions: true,
      },
    }),
    db.dailyKpi.aggregate({
      where: {
        campaign: { accountId: { in: accountIds } },
        date: { gte: priorStart, lt: priorEnd },
      },
      _sum: {
        impressions: true,
        clicks: true,
        costMicros: true,
        conversions: true,
      },
    }),
  ]);

  return {
    current: toWindowMetrics(current._sum),
    prior: toWindowMetrics(prior._sum),
    accountsInScope: accountIds.length,
  };
}

function empty(): WindowMetrics {
  return { impressions: 0, clicks: 0, spendUsd: 0, conversions: 0 };
}

function toWindowMetrics(sum: {
  impressions: bigint | null;
  clicks: bigint | null;
  costMicros: bigint | null;
  conversions: number | null;
}): WindowMetrics {
  return {
    impressions: bigIntToNumber(sum.impressions),
    clicks: bigIntToNumber(sum.clicks),
    spendUsd: microsToUsd(sum.costMicros),
    conversions: sum.conversions ?? 0,
  };
}

/**
 * Per-day series for the last N days (default 14). Returns oldest first.
 */
export async function getDailyTrend(args: {
  userId: string;
  demoMode: boolean;
  windowDays?: number;
}): Promise<TrendPoint[]> {
  const { userId, demoMode, windowDays = 14 } = args;
  const accountIds = await accountIdsInScope({ userId, demoMode });
  if (accountIds.length === 0) return [];

  const start = startOfUtcDay(windowDays - 1); // include today + N-1 days back
  const rows = await db.dailyKpi.groupBy({
    by: ["date"],
    where: {
      campaign: { accountId: { in: accountIds } },
      date: { gte: start },
    },
    _sum: { clicks: true, costMicros: true },
    orderBy: { date: "asc" },
  });

  // Fill in any missing days with zero (so the chart never has gaps).
  const map = new Map(
    rows.map((r) => [
      r.date.toISOString().slice(0, 10),
      {
        clicks: bigIntToNumber(r._sum.clicks),
        spendUsd: microsToUsd(r._sum.costMicros),
      },
    ]),
  );
  const series: TrendPoint[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = startOfUtcDay(i).toISOString().slice(0, 10);
    const v = map.get(d);
    series.push({
      date: d,
      clicks: v?.clicks ?? 0,
      spendUsd: v?.spendUsd ?? 0,
    });
  }
  return series;
}

/**
 * Top N campaigns by spend in the last N days. Default: top 5 / 30 days.
 */
export async function getTopCampaigns(args: {
  userId: string;
  demoMode: boolean;
  windowDays?: number;
  limit?: number;
}): Promise<TopCampaign[]> {
  const { userId, demoMode, windowDays = 30, limit = 5 } = args;
  const accountIds = await accountIdsInScope({ userId, demoMode });
  if (accountIds.length === 0) return [];

  const start = startOfUtcDay(windowDays);
  const grouped = await db.dailyKpi.groupBy({
    by: ["campaignId"],
    where: {
      campaign: { accountId: { in: accountIds } },
      date: { gte: start },
    },
    _sum: { costMicros: true, clicks: true },
    orderBy: { _sum: { costMicros: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const campaigns = await db.campaign.findMany({
    where: { id: { in: grouped.map((g) => g.campaignId) } },
    include: { account: { select: { descriptiveName: true } } },
  });
  const byId = new Map(campaigns.map((c) => [c.id, c]));

  return grouped
    .map((g): TopCampaign | null => {
      const c = byId.get(g.campaignId);
      if (!c) return null;
      return {
        id: c.id,
        name: c.name,
        channelType: c.channelType as ChannelType,
        status: c.status as CampaignStatus,
        accountName: c.account.descriptiveName ?? "Unnamed account",
        spendUsd: microsToUsd(g._sum.costMicros),
        clicks: bigIntToNumber(g._sum.clicks),
      };
    })
    .filter((c): c is TopCampaign => c !== null);
}
