import { auth } from "@/auth";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import {
  getDailyTrend,
  getKpiSummary,
  getTopCampaigns,
} from "@/lib/dashboard/kpis";

import { KpiTile } from "./_components/kpi-tile";
import { TrendChart } from "./_components/trend-chart";
import { TopCampaignsTable } from "./_components/top-campaigns-table";
import { OverviewEmpty } from "./_components/overview-empty";

export const metadata = {
  title: "Overview",
};

export default async function AppHome() {
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);

  const [summary, trend, top] = await Promise.all([
    getKpiSummary({ userId: user.id, demoMode }),
    getDailyTrend({ userId: user.id, demoMode, windowDays: 14 }),
    getTopCampaigns({ userId: user.id, demoMode, windowDays: 30, limit: 5 }),
  ]);

  return (
    <div className="container-page py-12 md:py-16">
      <Header
        name={user.name}
        demoMode={demoMode}
        accountsInScope={summary.accountsInScope}
      />

      {summary.accountsInScope === 0 ? (
        <div className="mt-10">
          {demoMode ? (
            <OverviewEmpty variant="demo" canSeed={user.role === "admin"} />
          ) : (
            <OverviewEmpty variant="live" canConnect />
          )}
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <section className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
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
              delta={pctDelta(
                summary.current.clicks,
                summary.prior.clicks,
              )}
              direction={direction(
                summary.current.clicks,
                summary.prior.clicks,
              )}
            />
            <KpiTile
              label="Spend"
              value={`$${formatUsd(summary.current.spendUsd)}`}
              delta={pctDelta(
                summary.current.spendUsd,
                summary.prior.spendUsd,
              )}
              direction={direction(
                summary.current.spendUsd,
                summary.prior.spendUsd,
              )}
              // Spend going up isn't inherently good — it's just spend.
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
          </section>

          {/* Trend */}
          <section className="mt-8">
            <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Last 14 days
                  </div>
                  <div className="mt-1 text-[15px] font-semibold tracking-tight">
                    Clicks trend
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <TrendChart data={trend} metric="clicks" />
              </div>
            </div>
          </section>

          {/* Top campaigns */}
          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Top 5 by spend · last 30 days
                </div>
                <div className="mt-1 text-[15px] font-semibold tracking-tight">
                  Top campaigns
                </div>
              </div>
            </div>
            <TopCampaignsTable rows={top} />
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + formatters
// ---------------------------------------------------------------------------
function Header({
  name,
  demoMode,
  accountsInScope,
}: {
  name: string | null | undefined;
  demoMode: boolean;
  accountsInScope: number;
}) {
  const firstName = name?.split(" ")[0] ?? "there";
  return (
    <header className="max-w-3xl">
      <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
        <span className="size-1 rounded-full bg-brand" />
        Overview · {demoMode ? "Demo data" : "Live data"}
      </div>
      <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
        Welcome back, {firstName}.
      </h1>
      <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
        {accountsInScope === 0
          ? "No accounts in scope. Connect one or seed demo data to get started."
          : `Tracking ${accountsInScope} account${accountsInScope === 1 ? "" : "s"}. Summary covers the last 30 days, with prior-period comparison.`}
      </p>
    </header>
  );
}

function direction(
  current: number,
  prior: number,
): "up" | "down" | "flat" {
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
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
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
