import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Megaphone } from "lucide-react";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import {
  getAccountDetail,
  getDailyTrend,
  getKpiSummary,
  getTopCampaigns,
} from "@/lib/dashboard/kpis";

import { KpiTile } from "../../_components/kpi-tile";
import { TopCampaignsTable } from "../../_components/top-campaigns-table";
import { TrendChart } from "../../_components/trend-chart";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return { title: "Account" };
  const demoMode = await getEffectiveDemoMode(session.user.role);
  const account = await getAccountDetail({
    userId: session.user.id,
    demoMode,
    accountId: id,
  });
  return {
    title: account?.descriptiveName ?? "Account",
  };
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);

  const account = await getAccountDetail({
    userId: user.id,
    demoMode,
    accountId: id,
  });
  if (!account) notFound();

  const [summary, trend, top] = await Promise.all([
    getKpiSummary({
      userId: user.id,
      demoMode,
      accountId: id,
      windowDays: 30,
    }),
    getDailyTrend({
      userId: user.id,
      demoMode,
      accountId: id,
      windowDays: 14,
    }),
    getTopCampaigns({
      userId: user.id,
      demoMode,
      accountId: id,
      windowDays: 30,
      limit: 5,
    }),
  ]);

  return (
    <div className="container-page py-12 md:py-16">
      {/* Breadcrumb */}
      <Link
        href="/app/accounts"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Accounts
      </Link>

      {/* Header */}
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
              {account.descriptiveName}
            </h1>
            {account.demoMode && (
              <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-violet-700">
                Demo
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12px] text-muted-foreground">
            <span>{formatCustomerId(account.customerId)}</span>
            {account.loginCustomerId && (
              <span>via MCC {formatCustomerId(account.loginCustomerId)}</span>
            )}
            <span>{account.currencyCode ?? "—"}</span>
            <span>{account.timeZone ?? "—"}</span>
          </div>
        </div>
        <Button
          variant="outline"
          render={<Link href={`/app/campaigns?accountId=${account.id}`} />}
        >
          <Megaphone />
          View campaigns
        </Button>
      </header>

      {/* Meta strip */}
      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetaTile
          label="Campaigns"
          value={account.campaignCount.toString()}
        />
        <MetaTile
          label="GA4"
          value={
            account.ga4Linked === true
              ? "Linked"
              : account.ga4Linked === false
                ? "Not linked"
                : "—"
          }
        />
        <MetaTile
          label="Connected"
          value={account.createdAt.toISOString().slice(0, 10)}
        />
        <MetaTile label="Profile" value={account.demoMode ? "Demo" : "Live"} />
      </section>

      {/* KPI tiles — last 30 days */}
      <section className="mt-10">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Last 30 days
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

      {/* Trend chart */}
      <section className="mt-8">
        <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Last 14 days
          </div>
          <div className="mt-1 text-[15px] font-semibold tracking-tight">
            Clicks trend
          </div>
          <div className="mt-4">
            <TrendChart data={trend} metric="clicks" />
          </div>
        </div>
      </section>

      {/* Top campaigns */}
      <section className="mt-8">
        <div className="mb-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Top 5 by spend · last 30 days
          </div>
          <div className="mt-1 text-[15px] font-semibold tracking-tight">
            Top campaigns
          </div>
        </div>
        <TopCampaignsTable rows={top} />
      </section>
    </div>
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

// ---------------------------------------------------------------------------
// Formatters (mirror the ones on /app)
// ---------------------------------------------------------------------------
function formatCustomerId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
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
