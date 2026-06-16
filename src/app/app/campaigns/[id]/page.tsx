import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import {
  getCampaignDetail,
  getDailyTrend,
  getKpiSummary,
} from "@/lib/dashboard/kpis";
import { activeProfile } from "@/lib/google-ads/auth";
import { launcherMaxDailyUsd } from "@/lib/google-ads/launcher";
import { cn } from "@/lib/utils";
import type { PmaxLaunchPayload } from "@/lib/wizard/payload-builder";

import { KpiTile } from "../../_components/kpi-tile";
import { TrendChart } from "../../_components/trend-chart";

import { LaunchCard } from "./launch-card";
import { PmaxSections } from "./pmax-sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return { title: "Campaign" };
  const demoMode = await getEffectiveDemoMode(session.user.role);
  const c = await getCampaignDetail({
    userId: session.user.id,
    demoMode,
    campaignId: id,
  });
  return { title: c?.name ?? "Campaign" };
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);

  const campaign = await getCampaignDetail({
    userId: user.id,
    demoMode,
    campaignId: id,
  });
  if (!campaign) notFound();

  const [summary, trend] = await Promise.all([
    getKpiSummary({
      userId: user.id,
      demoMode,
      campaignId: id,
      windowDays: 30,
    }),
    getDailyTrend({
      userId: user.id,
      demoMode,
      campaignId: id,
      windowDays: 14,
    }),
  ]);

  return (
    <div className="container-page py-12 md:py-16">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Link
          href="/app/campaigns"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Campaigns
        </Link>
        <span aria-hidden>·</span>
        <Link
          href={`/app/accounts/${campaign.accountId}`}
          className="transition-colors hover:text-foreground"
        >
          {campaign.accountName}
        </Link>
      </div>

      {/* Header */}
      <header className="mt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h1 className="text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
              {campaign.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={campaign.status} />
              <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                {campaign.channelType}
              </span>
              {campaign.demoMode && (
                <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                  Demo
                </span>
              )}
              {campaign.providerCampaignId && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  ID {campaign.providerCampaignId}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Meta strip */}
      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetaTile
          label="Daily budget"
          value={
            campaign.dailyBudgetUsd != null
              ? `$${campaign.dailyBudgetUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : "—"
          }
        />
        <MetaTile
          label="Bidding"
          value={
            campaign.biddingStrategy
              ? prettifyStrategy(campaign.biddingStrategy)
              : "—"
          }
        />
        <MetaTile
          label="Created"
          value={campaign.createdAt.toISOString().slice(0, 10)}
        />
        <MetaTile
          label="Last sync"
          value={campaign.updatedAt.toISOString().slice(0, 10)}
        />
      </section>

      {/* KPI tiles — last 30 days */}
      <section className="mt-10">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Last 30 days · vs prior 30
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiTile
            label="Impressions"
            value={formatBigNumber(summary.current.impressions)}
            delta={pctDelta(
              summary.current.impressions,
              summary.prior.impressions,
            )}
            direction={direction(
              summary.current.impressions,
              summary.prior.impressions,
            )}
          />
          <KpiTile
            label="Clicks"
            value={formatBigNumber(summary.current.clicks)}
            delta={pctDelta(summary.current.clicks, summary.prior.clicks)}
            direction={direction(summary.current.clicks, summary.prior.clicks)}
          />
          <KpiTile
            label="Spend"
            value={`$${formatUsd(summary.current.spendUsd)}`}
            delta={pctDelta(summary.current.spendUsd, summary.prior.spendUsd)}
            direction={direction(
              summary.current.spendUsd,
              summary.prior.spendUsd,
            )}
            goodIsUp={false}
          />
          <KpiTile
            label="Conversions"
            value={formatBigNumber(summary.current.conversions)}
            delta={pctDelta(
              summary.current.conversions,
              summary.prior.conversions,
            )}
            direction={direction(
              summary.current.conversions,
              summary.prior.conversions,
            )}
          />
        </div>
      </section>

      {/* Trend */}
      <section className="mt-8">
        <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Last 14 days · clicks
          </div>
          <div className="mt-1 text-[15px] font-semibold tracking-tight">
            Clicks trend
          </div>
          <div className="mt-4">
            <TrendChart data={trend} metric="clicks" />
          </div>
        </div>
      </section>

      {/* Launch to Google — live campaigns only; demo campaigns can't launch. */}
      {!campaign.demoMode &&
        (campaign.channelType === "SEARCH" ||
          campaign.channelType === "PMAX") && (
          <section className="mt-10">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Launcher
            </div>
            <div className="mt-3">
              <LaunchCardWrapper
                campaignId={campaign.id}
                dailyUsd={campaign.dailyBudgetUsd}
              />
            </div>
          </section>
        )}

      {/* PMAX-specific sub-resources: asset group + ad copy +
          conversion-tracking notice. For SEARCH we keep the placeholder
          tiles below. */}
      {campaign.channelType === "PMAX" && campaign.payloadJson != null && (
        <PmaxSections
          payload={campaign.payloadJson as PmaxLaunchPayload}
          alreadyLaunched={!!campaign.providerCampaignId}
        />
      )}

      {/* SEARCH sub-resources placeholder */}
      {campaign.channelType === "SEARCH" && (
        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <SubCard
          title="Ad groups"
          count="—"
          body="Multi-ad-group support arrives with the campaign create wizard (Phase 3) and full launch port (Phase 4)."
        />
        <SubCard
          title="Ads"
          count="—"
          body="Responsive search ads, image ads, and Performance Max asset groups will live here."
        />
        <SubCard
          title="Keywords"
          count="—"
          body="Positive and negative keywords surface in Phase 3 along with the keyword theme editor."
        />
        </section>
      )}

      {/* YAML payload (if any) */}
      {campaign.yamlText && (
        <section className="mt-8">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Last built payload
          </div>
          <pre className="mt-3 max-h-96 overflow-auto rounded-xl border border-border bg-card p-4 font-mono text-[11px] leading-5 text-foreground">
            {campaign.yamlText}
          </pre>
        </section>
      )}
    </div>
  );
}

/**
 * Wrapper that fetches launch-state from DB and decides what to render.
 * Kept inline so the page reads top-to-bottom.
 */
async function LaunchCardWrapper({
  campaignId,
  dailyUsd,
}: {
  campaignId: string;
  dailyUsd: number | null;
}) {
  const c = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      providerCampaignId: true,
      launchedAt: true,
      launchedProfile: true,
    },
  });
  return (
    <LaunchCard
      campaignId={campaignId}
      profile={activeProfile()}
      maxDailyUsd={launcherMaxDailyUsd()}
      dailyUsd={dailyUsd}
      alreadyLaunched={
        c?.providerCampaignId
          ? {
              providerCampaignId: c.providerCampaignId,
              profile: (c.launchedProfile as "test" | "prod" | null) ?? null,
              launchedAt: c.launchedAt,
            }
          : null
      }
    />
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-[14px] font-medium">{value}</div>
    </div>
  );
}

function SubCard({
  title,
  count,
  body,
}: {
  title: string;
  count: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {count}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] leading-5 text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: "ENABLED" | "PAUSED" | "REMOVED" }) {
  const map = {
    ENABLED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    PAUSED: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    REMOVED: "bg-muted text-muted-foreground border-border",
  } as const;
  const label =
    status === "ENABLED" ? "Live" : status === "PAUSED" ? "Paused" : "Removed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium",
        map[status],
      )}
    >
      {label}
    </span>
  );
}

function prettifyStrategy(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function direction(current: number, prior: number): "up" | "down" | "flat" {
  if (prior === 0 && current === 0) return "flat";
  if (current === prior) return "flat";
  return current > prior ? "up" : "down";
}

function pctDelta(current: number, prior: number): string | null {
  if (prior === 0) {
    if (current === 0) return "0%";
    return "new";
  }
  const pct = ((current - prior) / prior) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatBigNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
