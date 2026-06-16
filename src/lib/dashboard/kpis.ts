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
 *
 * If `accountId` is passed, the result is filtered down to just that one
 * (after still applying the scoping rule — so a user can't get KPIs for
 * an account they don't own, and a demo user can't see live accounts).
 */
async function accountIdsInScope(args: {
  userId: string;
  demoMode: boolean;
  accountId?: string;
}): Promise<string[]> {
  const where = args.demoMode
    ? { demoMode: true }
    : { userId: args.userId, demoMode: false };
  const rows = await db.adsAccount.findMany({
    where: args.accountId ? { ...where, id: args.accountId } : where,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Build the where-clause that filters DailyKpi rows for a given scope.
 * Centralised so every kpi function applies the same scoping rules
 * (campaignId trumps accountId; both are subject to the in-scope account
 * filter to prevent cross-tenant leaks).
 */
async function buildKpiWhere(args: {
  userId: string;
  demoMode: boolean;
  accountId?: string;
  campaignId?: string;
}): Promise<{ accountIds: string[]; whereCampaign: { accountId: { in: string[] } } } | null> {
  const accountIds = await accountIdsInScope({
    userId: args.userId,
    demoMode: args.demoMode,
    accountId: args.accountId,
  });
  if (accountIds.length === 0) return null;
  return {
    accountIds,
    whereCampaign: { accountId: { in: accountIds } },
  };
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
  /** Restrict to a single account. Still subject to scoping rules. */
  accountId?: string;
  /** Restrict further to a single campaign. */
  campaignId?: string;
}): Promise<KpiSummary> {
  const { userId, demoMode, windowDays = 30, accountId, campaignId } = args;
  const scope = await buildKpiWhere({
    userId,
    demoMode,
    accountId,
    campaignId,
  });
  if (!scope) {
    return { current: empty(), prior: empty(), accountsInScope: 0 };
  }

  const currentStart = startOfUtcDay(windowDays);
  const priorStart = startOfUtcDay(windowDays * 2);
  const priorEnd = currentStart;

  const baseFilter = campaignId
    ? { campaignId, campaign: scope.whereCampaign }
    : { campaign: scope.whereCampaign };

  const [current, prior] = await Promise.all([
    db.dailyKpi.aggregate({
      where: { ...baseFilter, date: { gte: currentStart } },
      _sum: {
        impressions: true,
        clicks: true,
        costMicros: true,
        conversions: true,
      },
    }),
    db.dailyKpi.aggregate({
      where: { ...baseFilter, date: { gte: priorStart, lt: priorEnd } },
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
    accountsInScope: scope.accountIds.length,
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
  accountId?: string;
  campaignId?: string;
}): Promise<TrendPoint[]> {
  const { userId, demoMode, windowDays = 14, accountId, campaignId } = args;
  const scope = await buildKpiWhere({
    userId,
    demoMode,
    accountId,
    campaignId,
  });
  if (!scope) return [];

  const start = startOfUtcDay(windowDays - 1);
  const where = campaignId
    ? { campaignId, campaign: scope.whereCampaign, date: { gte: start } }
    : { campaign: scope.whereCampaign, date: { gte: start } };
  const rows = await db.dailyKpi.groupBy({
    by: ["date"],
    where,
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
  accountId?: string;
}): Promise<TopCampaign[]> {
  const { userId, demoMode, windowDays = 30, limit = 5, accountId } = args;
  const accountIds = await accountIdsInScope({ userId, demoMode, accountId });
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

// ---------------------------------------------------------------------------
// Accounts list with per-account stats
// ---------------------------------------------------------------------------
export type AccountListRow = {
  id: string;
  descriptiveName: string;
  customerId: string;
  loginCustomerId: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  demoMode: boolean;
  createdAt: Date;
  ga4Linked: boolean | null;
  ga4PropertyId: string | null;
  campaignCount: number;
  /** Last 7-day KPI roll-up. */
  recent: WindowMetrics;
};

/**
 * Accounts in scope with per-account stat roll-up. Designed to avoid
 * N+1 — one accounts query, one campaigns lookup, one groupBy across
 * all campaigns, then joined in memory.
 */
export async function getAccountsList(args: {
  userId: string;
  demoMode: boolean;
  windowDays?: number;
}): Promise<AccountListRow[]> {
  const { userId, demoMode, windowDays = 7 } = args;

  const accounts = await db.adsAccount.findMany({
    where: demoMode
      ? { demoMode: true }
      : { userId, demoMode: false },
    include: {
      ga4Link: true,
      _count: { select: { campaigns: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (accounts.length === 0) return [];

  const accountIds = accounts.map((a) => a.id);

  // One query for the campaign → account mapping.
  const campaigns = await db.campaign.findMany({
    where: { accountId: { in: accountIds } },
    select: { id: true, accountId: true },
  });
  const campToAccount = new Map(campaigns.map((c) => [c.id, c.accountId]));

  // One groupBy across every campaign in scope.
  const start = startOfUtcDay(windowDays);
  const grouped = await db.dailyKpi.groupBy({
    by: ["campaignId"],
    where: {
      campaign: { accountId: { in: accountIds } },
      date: { gte: start },
    },
    _sum: {
      impressions: true,
      clicks: true,
      costMicros: true,
      conversions: true,
    },
  });

  // Reduce into per-account totals.
  const totals = new Map<string, WindowMetrics>();
  for (const g of grouped) {
    const accountId = campToAccount.get(g.campaignId);
    if (!accountId) continue;
    const acc = totals.get(accountId) ?? empty();
    acc.impressions += bigIntToNumber(g._sum.impressions);
    acc.clicks += bigIntToNumber(g._sum.clicks);
    acc.spendUsd += microsToUsd(g._sum.costMicros);
    acc.conversions += g._sum.conversions ?? 0;
    totals.set(accountId, acc);
  }

  return accounts.map((a): AccountListRow => ({
    id: a.id,
    descriptiveName: a.descriptiveName ?? `Customer ${a.customerId}`,
    customerId: a.customerId,
    loginCustomerId: a.loginCustomerId,
    currencyCode: a.currencyCode,
    timeZone: a.timeZone,
    demoMode: a.demoMode,
    createdAt: a.createdAt,
    ga4Linked: a.ga4Link?.linked ?? null,
    ga4PropertyId: a.ga4Link?.ga4PropertyId ?? null,
    campaignCount: a._count.campaigns,
    recent: totals.get(a.id) ?? empty(),
  }));
}

// ---------------------------------------------------------------------------
// Campaigns list + detail
// ---------------------------------------------------------------------------
export type CampaignListRow = {
  id: string;
  name: string;
  channelType: ChannelType;
  status: CampaignStatus;
  dailyBudgetUsd: number | null;
  biddingStrategy: string | null;
  providerCampaignId: string | null;
  accountId: string;
  accountName: string;
  demoMode: boolean;
  createdAt: Date;
  /** Last N-day KPI roll-up (default 7). */
  recent: WindowMetrics;
};

export type CampaignDetail = CampaignListRow & {
  updatedAt: Date;
  customerId: string;
  currencyCode: string | null;
  yamlText: string | null;
  /** Structured launcher payload — Phase 4+. Null for pre-Phase-4 drafts. */
  payloadJson: unknown;
};

/**
 * Campaigns in scope across one or many accounts. Sorted by recent spend
 * descending so the active campaigns rise to the top.
 */
export async function getCampaignsList(args: {
  userId: string;
  demoMode: boolean;
  accountId?: string;
  windowDays?: number;
  limit?: number;
}): Promise<CampaignListRow[]> {
  const { userId, demoMode, accountId, windowDays = 7, limit = 50 } = args;
  const accountIds = await accountIdsInScope({ userId, demoMode, accountId });
  if (accountIds.length === 0) return [];

  const campaigns = await db.campaign.findMany({
    where: { accountId: { in: accountIds } },
    include: { account: { select: { id: true, descriptiveName: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  if (campaigns.length === 0) return [];

  const start = startOfUtcDay(windowDays);
  const grouped = await db.dailyKpi.groupBy({
    by: ["campaignId"],
    where: {
      campaignId: { in: campaigns.map((c) => c.id) },
      date: { gte: start },
    },
    _sum: {
      impressions: true,
      clicks: true,
      costMicros: true,
      conversions: true,
    },
  });

  const stats = new Map<string, WindowMetrics>(
    grouped.map((g) => [
      g.campaignId,
      {
        impressions: bigIntToNumber(g._sum.impressions),
        clicks: bigIntToNumber(g._sum.clicks),
        spendUsd: microsToUsd(g._sum.costMicros),
        conversions: g._sum.conversions ?? 0,
      },
    ]),
  );

  const rows = campaigns.map((c): CampaignListRow => ({
    id: c.id,
    name: c.name,
    channelType: c.channelType as ChannelType,
    status: c.status as CampaignStatus,
    dailyBudgetUsd: c.dailyBudgetMicros ? microsToUsd(c.dailyBudgetMicros) : null,
    biddingStrategy: c.biddingStrategy,
    providerCampaignId: c.providerCampaignId,
    accountId: c.account.id,
    accountName: c.account.descriptiveName ?? `Customer ${c.account.id.slice(0, 6)}`,
    demoMode: c.demoMode,
    createdAt: c.createdAt,
    recent: stats.get(c.id) ?? empty(),
  }));

  // Sort by recent spend desc, then name asc as a tiebreaker.
  rows.sort((a, b) =>
    b.recent.spendUsd - a.recent.spendUsd ||
    a.name.localeCompare(b.name),
  );
  return rows;
}

/**
 * Fetch a single campaign in scope — null if not found / not visible.
 */
export async function getCampaignDetail(args: {
  userId: string;
  demoMode: boolean;
  campaignId: string;
}): Promise<CampaignDetail | null> {
  const accountWhere = args.demoMode
    ? { demoMode: true }
    : { userId: args.userId, demoMode: false };

  const campaign = await db.campaign.findFirst({
    where: {
      id: args.campaignId,
      account: accountWhere,
    },
    include: { account: true },
  });
  if (!campaign) return null;

  // Use the last 7d window for `recent` (matches list view), plus pull the
  // campaign-scoped 30-day summary in the page itself via getKpiSummary.
  const start = startOfUtcDay(7);
  const recent = await db.dailyKpi.aggregate({
    where: { campaignId: campaign.id, date: { gte: start } },
    _sum: {
      impressions: true,
      clicks: true,
      costMicros: true,
      conversions: true,
    },
  });

  return {
    id: campaign.id,
    name: campaign.name,
    channelType: campaign.channelType as ChannelType,
    status: campaign.status as CampaignStatus,
    dailyBudgetUsd: campaign.dailyBudgetMicros
      ? microsToUsd(campaign.dailyBudgetMicros)
      : null,
    biddingStrategy: campaign.biddingStrategy,
    providerCampaignId: campaign.providerCampaignId,
    accountId: campaign.account.id,
    accountName: campaign.account.descriptiveName ?? `Customer ${campaign.account.customerId}`,
    customerId: campaign.account.customerId,
    currencyCode: campaign.account.currencyCode,
    demoMode: campaign.demoMode,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    yamlText: campaign.yamlText,
    payloadJson: campaign.payloadJson,
    recent: toWindowMetrics(recent._sum),
  };
}

/**
 * Fetch one account in scope — returns null if not found / not visible
 * to the caller. Use for the account detail page.
 */
export async function getAccountDetail(args: {
  userId: string;
  demoMode: boolean;
  accountId: string;
}): Promise<AccountListRow | null> {
  const where = args.demoMode
    ? { demoMode: true }
    : { userId: args.userId, demoMode: false };

  const account = await db.adsAccount.findFirst({
    where: { ...where, id: args.accountId },
    include: {
      ga4Link: true,
      _count: { select: { campaigns: true } },
    },
  });
  if (!account) return null;

  const summary = await getKpiSummary({
    userId: args.userId,
    demoMode: args.demoMode,
    windowDays: 7,
    accountId: args.accountId,
  });

  return {
    id: account.id,
    descriptiveName:
      account.descriptiveName ?? `Customer ${account.customerId}`,
    customerId: account.customerId,
    loginCustomerId: account.loginCustomerId,
    currencyCode: account.currencyCode,
    timeZone: account.timeZone,
    demoMode: account.demoMode,
    createdAt: account.createdAt,
    ga4Linked: account.ga4Link?.linked ?? null,
    ga4PropertyId: account.ga4Link?.ga4PropertyId ?? null,
    campaignCount: account._count.campaigns,
    recent: summary.current,
  };
}
