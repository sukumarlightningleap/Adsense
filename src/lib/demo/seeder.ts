/**
 * Demo data seeder — port of
 * adwords-benchmarks/src/launcher/demo/seeder.py.
 *
 * Demo data is **org-wide**: every demo user sees the same shared set.
 * It's owned in the DB by whichever admin triggered the seed (their
 * userId is on `accounts` for the FK), but read queries that target
 * demo data ignore userId and just filter on `demoMode = true`.
 *
 * Generates:
 *   - 3 accounts shaped (mature / new-sparse / all-paused) — the three
 *     shapes the benchmark engine specifically handles.
 *   - 5–8 campaigns per account across SEARCH / PMAX / DISPLAY /
 *     VIDEO / DISCOVERY.
 *   - 90 days of daily KPIs with weekend dips + trend slope.
 *   - 1–3 placeholder image assets per non-SEARCH campaign.
 *
 * Determinism: the RNG is seeded with `seed:<today's UTC date>`, so a
 * re-seed within the same calendar day produces identical data.
 */
import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import type {
  AssetKind,
  AssetRole,
  CampaignStatus,
  ChannelType,
} from "@/lib/ads/types";
import { placeholderPng } from "./placeholder-image";

const CHANNELS: ChannelType[] = [
  "SEARCH",
  "PMAX",
  "DISPLAY",
  "VIDEO",
  "DISCOVERY",
];

type AccountShape = {
  descriptiveName: string;
  shape: "mature" | "sparse" | "paused";
  nCampaigns: [number, number];
  activeRatio: number;
  baseDailyClicks: [number, number];
  baseCtr: [number, number];
  baseCpcUsd: [number, number];
  baseCvr: [number, number];
  aovUsd: [number, number];
  trendSlopePctPerDay: [number, number];
};

const ACCOUNT_SHAPES: AccountShape[] = [
  {
    descriptiveName: "Brooklyn Reads — Mature",
    shape: "mature",
    nCampaigns: [5, 8],
    activeRatio: 0.8,
    baseDailyClicks: [180, 420],
    baseCtr: [0.04, 0.08],
    baseCpcUsd: [0.55, 1.8],
    baseCvr: [0.025, 0.05],
    aovUsd: [28, 65],
    trendSlopePctPerDay: [-0.001, 0.004],
  },
  {
    descriptiveName: "Aurora Wellness — New",
    shape: "sparse",
    nCampaigns: [2, 3],
    activeRatio: 1.0,
    baseDailyClicks: [8, 35],
    baseCtr: [0.02, 0.05],
    baseCpcUsd: [0.9, 2.4],
    baseCvr: [0.005, 0.02],
    aovUsd: [40, 90],
    trendSlopePctPerDay: [0.002, 0.008],
  },
  {
    descriptiveName: "Iron Ridge Outfitters — Paused",
    shape: "paused",
    nCampaigns: [3, 5],
    activeRatio: 0.0,
    baseDailyClicks: [0, 0],
    baseCtr: [0, 0],
    baseCpcUsd: [1.0, 1.0],
    baseCvr: [0, 0],
    aovUsd: [35, 60],
    trendSlopePctPerDay: [0, 0],
  },
];

const CAMPAIGN_NAME_BITS = [
  ["Spring", "Summer", "Fall", "Holiday", "Evergreen", "Q3", "Q4"],
  [
    "Brand",
    "Generic",
    "Competitor",
    "Retargeting",
    "Prospecting",
    "DR",
    "Awareness",
  ],
];

// ---------------------------------------------------------------------------
// Seeded RNG — Mulberry32. Mirrors Python's seed-from-md5-hexdigest pattern.
// ---------------------------------------------------------------------------
type RNG = {
  random(): number;
  randint(min: number, max: number): number;
  uniform(min: number, max: number): number;
  choice<T>(items: readonly T[]): T;
};

function makeRng(salt: string): RNG {
  // Match the Python seeder: md5(salt) → take first 16 hex chars → int.
  // Truncate to 32-bit for Mulberry32 seed.
  const hex = createHash("md5").update(salt).digest("hex").slice(0, 8);
  let seed = parseInt(hex, 16) >>> 0;

  function next(): number {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    random: next,
    uniform(min, max) {
      return min + (max - min) * next();
    },
    randint(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    choice<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

// ---------------------------------------------------------------------------
// KPI shape generator — mirrors `_daily_kpi_for` in Python.
// ---------------------------------------------------------------------------
type DailyMetrics = {
  impressions: bigint;
  clicks: bigint;
  costMicros: bigint;
  conversions: number;
  conversionValueMicros: bigint;
};

function dailyKpiFor(args: {
  dayIdx: number;
  totalDays: number;
  rng: RNG;
  shape: AccountShape;
  paused: boolean;
}): DailyMetrics {
  const { dayIdx, totalDays, rng, shape, paused } = args;

  if (paused || shape.shape === "paused") {
    return {
      impressions: 0n,
      clicks: 0n,
      costMicros: 0n,
      conversions: 0,
      conversionValueMicros: 0n,
    };
  }

  const daysBack = totalDays - 1 - dayIdx;
  const todayUTC = new Date();
  const targetDay = new Date(todayUTC);
  targetDay.setUTCDate(todayUTC.getUTCDate() - daysBack);
  const weekday = targetDay.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const weekendFactor = weekday === 0 || weekday === 6 ? 0.78 : 1.0;

  const slope = rng.uniform(...shape.trendSlopePctPerDay);
  const trend = 1.0 + slope * dayIdx;
  const noise = rng.uniform(0.82, 1.18);

  const baseClicks =
    rng.uniform(...shape.baseDailyClicks) * weekendFactor * trend * noise;
  const clicks = Math.max(0, Math.round(baseClicks));

  const ctr = Math.max(
    0.001,
    Math.min(0.25, rng.uniform(...shape.baseCtr) * rng.uniform(0.9, 1.1)),
  );
  const impressions = clicks ? Math.round(clicks / ctr) : 0;

  const cpc = Math.max(
    0.05,
    rng.uniform(...shape.baseCpcUsd) * rng.uniform(0.9, 1.1),
  );
  const costMicros = Math.round(clicks * cpc * 1_000_000);

  const cvr = Math.max(0, rng.uniform(...shape.baseCvr) * rng.uniform(0.7, 1.3));
  const conversions = Math.round(clicks * cvr * 100) / 100;

  const aov = rng.uniform(...shape.aovUsd);
  const conversionValueMicros = Math.round(conversions * aov * 1_000_000);

  return {
    impressions: BigInt(impressions),
    clicks: BigInt(clicks),
    costMicros: BigInt(costMicros),
    conversions,
    conversionValueMicros: BigInt(conversionValueMicros),
  };
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function nameForCampaign(rng: RNG, channel: ChannelType): string {
  const a = rng.choice(CAMPAIGN_NAME_BITS[0]!);
  const b = rng.choice(CAMPAIGN_NAME_BITS[1]!);
  return `${a} ${b} — ${channel}`;
}

function makeCustomerId(rng: RNG): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += String(rng.randint(0, 9));
  return s;
}

function dateNDaysBack(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export type SeedSummary = {
  ownerUserId: string;
  accounts: number;
  campaigns: number;
  dailyKpis: number;
  assets: number;
};

export type DemoStats = {
  accounts: number;
  campaigns: number;
  dailyKpis: number;
  assets: number;
};

/**
 * Wipe the existing org-wide demo data, then create a fresh set.
 *
 * `ownerUserId` is whichever admin clicked the Seed button — used as
 * `AdsAccount.userId` to satisfy the NOT NULL constraint. Demo data is
 * READ org-wide (queries filter on `demoMode = true`, not userId).
 */
export async function seedDemoData(args: {
  ownerUserId: string;
  nAccounts?: number;
  days?: number;
}): Promise<SeedSummary> {
  const { ownerUserId, nAccounts = 3, days = 90 } = args;
  const rng = makeRng(`seed:${todayUtcDateString()}`);

  await wipeDemoData();

  const shapes =
    nAccounts <= ACCOUNT_SHAPES.length
      ? ACCOUNT_SHAPES.slice(0, nAccounts)
      : [
          ...ACCOUNT_SHAPES,
          ...Array.from({ length: nAccounts - ACCOUNT_SHAPES.length }).map(
            () => ACCOUNT_SHAPES[0]!,
          ),
        ];

  let totalCampaigns = 0;
  let totalKpis = 0;
  let totalAssets = 0;

  for (const shape of shapes) {
    const account = await db.adsAccount.create({
      data: {
        userId: ownerUserId,
        provider: "google_ads",
        customerId: makeCustomerId(rng),
        descriptiveName: shape.descriptiveName,
        currencyCode: "USD",
        timeZone: "America/New_York",
        demoMode: true,
      },
    });

    await db.ga4LinkStatus.create({
      data: {
        accountId: account.id,
        ga4PropertyId:
          shape.shape === "sparse"
            ? null
            : `properties/${rng.randint(100_000_000, 999_999_999)}`,
        linked: shape.shape !== "sparse",
        lastCheckedAt: new Date(),
      },
    });

    const nCampaigns = rng.randint(
      shape.nCampaigns[0],
      shape.nCampaigns[1],
    );

    for (let c = 0; c < nCampaigns; c++) {
      const channel = rng.choice(CHANNELS);
      const isActive = rng.random() < shape.activeRatio;
      const budgetUsd = rng.choice([15, 25, 40, 75, 120, 200] as const);
      const status: CampaignStatus = isActive ? "ENABLED" : "PAUSED";

      const campaign = await db.campaign.create({
        data: {
          accountId: account.id,
          providerCampaignId: String(
            rng.randint(10_000_000_000, 99_999_999_999),
          ),
          name: nameForCampaign(rng, channel),
          channelType: channel,
          status,
          dailyBudgetMicros: BigInt(budgetUsd * 1_000_000),
          biddingStrategy: rng.choice([
            "MAXIMIZE_CONVERSIONS",
            "TARGET_CPA",
            "MAXIMIZE_CLICKS",
          ] as const),
          demoMode: true,
        },
      });
      totalCampaigns++;

      // Daily KPIs — batch insert for speed.
      const kpiRows = [];
      for (let d = 0; d < days; d++) {
        const day = dateNDaysBack(days - 1 - d);
        const metrics = dailyKpiFor({
          dayIdx: d,
          totalDays: days,
          rng,
          shape,
          paused: !isActive,
        });
        kpiRows.push({
          campaignId: campaign.id,
          date: day,
          ...metrics,
        });
      }
      await db.dailyKpi.createMany({ data: kpiRows });
      totalKpis += kpiRows.length;

      // Image assets for non-SEARCH channels.
      if (channel !== "SEARCH") {
        const nAssets = rng.randint(1, 3);
        for (let i = 0; i < nAssets; i++) {
          const label = `${campaign.name.slice(0, 30)} #${i + 1}`;
          // Prisma's `Bytes` field expects `Uint8Array<ArrayBuffer>` (strict)
          // — `Buffer` satisfies that. `new Uint8Array(...)` from our shared
          // array doesn't, so we wrap.
          const bytes = Buffer.from(placeholderPng());
          const sha256 = createHash("sha256")
            .update(bytes)
            .update(`${campaign.id}:${i}`) // salt so each row's sha is unique
            .digest("hex");

          const asset = await db.asset.create({
            data: {
              userId: ownerUserId,
              accountId: account.id,
              name: label,
              kind: "image" satisfies AssetKind,
              mime: "image/png",
              sha256,
              bytes,
              demoMode: true,
            },
          });

          await db.campaignAsset.create({
            data: {
              campaignId: campaign.id,
              assetId: asset.id,
              role: "marketing_image" satisfies AssetRole,
            },
          });
          totalAssets++;
        }
      }
    }
  }

  return {
    ownerUserId,
    accounts: shapes.length,
    campaigns: totalCampaigns,
    dailyKpis: totalKpis,
    assets: totalAssets,
  };
}

/**
 * Wipe all demo data (org-wide). Real data untouched.
 */
export async function wipeDemoData(): Promise<{ demoAccountsDeleted: number }> {
  // Benchmarks FK to accountId without cascade-from-Account, so wipe first.
  await db.benchmarkSnapshot.deleteMany({
    where: { account: { demoMode: true } },
  });
  // Orphan demo assets (accountId NULL but demoMode=true): wipe explicitly.
  await db.asset.deleteMany({ where: { demoMode: true } });
  // Accounts cascade to campaigns, KPIs, ga4_link_status, etc.
  const result = await db.adsAccount.deleteMany({ where: { demoMode: true } });
  return { demoAccountsDeleted: result.count };
}

/**
 * Quick stats for the admin demo page. All four counts in one shot.
 */
export async function getDemoStats(): Promise<DemoStats> {
  const [accounts, campaigns, dailyKpis, assets] = await Promise.all([
    db.adsAccount.count({ where: { demoMode: true } }),
    db.campaign.count({ where: { demoMode: true } }),
    db.dailyKpi.count({
      where: { campaign: { demoMode: true } },
    }),
    db.asset.count({ where: { demoMode: true } }),
  ]);
  return { accounts, campaigns, dailyKpis, assets };
}
