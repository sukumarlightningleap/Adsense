import Link from "next/link";
import { Megaphone } from "lucide-react";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import {
  getAccountsList,
  getCampaignsList,
  type CampaignListRow,
} from "@/lib/dashboard/kpis";
import { cn } from "@/lib/utils";

import { AccountFilter } from "./_components/account-filter";

export const metadata = {
  title: "Campaigns",
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);
  const { accountId } = await searchParams;

  // Fetch accounts (for the filter dropdown) and campaigns in parallel.
  const [accounts, campaigns] = await Promise.all([
    getAccountsList({ userId: user.id, demoMode, windowDays: 7 }),
    getCampaignsList({
      userId: user.id,
      demoMode,
      accountId: accountId || undefined,
      windowDays: 7,
      limit: 100,
    }),
  ]);

  const selectedAccount = accountId
    ? accounts.find((a) => a.id === accountId) ?? null
    : null;

  return (
    <div className="container-page py-12 md:py-16">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
            <span className="size-1 rounded-full bg-brand" />
            Campaigns · {demoMode ? "Demo data" : "Live data"}
          </div>
          <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
            {selectedAccount ? selectedAccount.descriptiveName : "All campaigns"}
          </h1>
          <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
            {campaigns.length === 0
              ? "Nothing to show yet."
              : `Sorted by spend over the last 7 days. Top ${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {accounts.length > 0 && (
            <AccountFilter
              accounts={accounts.map((a) => ({
                id: a.id,
                name: a.descriptiveName,
              }))}
              currentAccountId={accountId ?? null}
            />
          )}
          {user.role !== "demo" && !demoMode && (
            <Button render={<Link href="/app/campaigns/new" />}>
              New campaign
            </Button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="mt-10">
        {campaigns.length === 0 ? (
          <EmptyState demoMode={demoMode} accountFiltered={!!accountId} />
        ) : (
          <CampaignsTable rows={campaigns} />
        )}
      </div>
    </div>
  );
}

function CampaignsTable({ rows }: { rows: CampaignListRow[] }) {
  return (
    <>
      {/* Mobile — card list */}
      <ul className="space-y-3 md:hidden">
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              href={`/app/campaigns/${c.id}`}
              className="block rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {c.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {c.accountName}
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                  {c.channelType}
                </span>
                {c.providerCampaignId && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ID {c.providerCampaignId}
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                <Stat
                  label="Budget/day"
                  value={
                    c.dailyBudgetUsd != null
                      ? `$${c.dailyBudgetUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                      : "—"
                  }
                />
                <Stat
                  label="Clicks 7d"
                  value={compact(c.recent.clicks)}
                />
                <Stat
                  label="Spend 7d"
                  value={`$${c.recent.spendUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                  emphasize
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop — table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
        <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/30 px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <div className="col-span-4">Campaign</div>
          <div className="col-span-2">Account</div>
          <div className="col-span-1">Channel</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1 text-right">Budget/day</div>
          <div className="col-span-1 text-right">Clicks 7d</div>
          <div className="col-span-2 text-right">Spend 7d</div>
        </div>
        {rows.map((c) => (
          <Link
            key={c.id}
            href={`/app/campaigns/${c.id}`}
            className="grid grid-cols-12 items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0 transition-colors hover:bg-muted/30"
          >
            <div className="col-span-4 min-w-0">
              <div className="truncate text-[13.5px] font-medium">{c.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {c.providerCampaignId ?? "—"}
              </div>
            </div>
            <div className="col-span-2 min-w-0 truncate text-[12px] text-muted-foreground">
              {c.accountName}
            </div>
            <div className="col-span-1">
              <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {c.channelType}
              </span>
            </div>
            <div className="col-span-1">
              <StatusBadge status={c.status} />
            </div>
            <div className="col-span-1 text-right font-mono text-[12px] tabular-nums">
              {c.dailyBudgetUsd != null
                ? `$${c.dailyBudgetUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                : "—"}
            </div>
            <div className="col-span-1 text-right font-mono text-[12px] tabular-nums">
              {compact(c.recent.clicks)}
            </div>
            <div className="col-span-2 text-right font-mono text-[12px] font-medium tabular-nums">
              ${c.recent.spendUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono tabular-nums ${emphasize ? "font-medium text-foreground" : "text-foreground/80"}`}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignListRow["status"] }) {
  const map: Record<CampaignListRow["status"], string> = {
    ENABLED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    PAUSED: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    REMOVED: "bg-muted text-muted-foreground border-border",
  };
  const label =
    status === "ENABLED" ? "Live" : status === "PAUSED" ? "Paused" : "Removed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        map[status],
      )}
    >
      {label}
    </span>
  );
}

function EmptyState({
  demoMode,
  accountFiltered,
}: {
  demoMode: boolean;
  accountFiltered: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
      <div className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
        <Megaphone className="size-5" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        {accountFiltered
          ? "No campaigns in this account"
          : demoMode
            ? "No demo campaigns"
            : "No campaigns yet"}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-muted-foreground">
        {accountFiltered
          ? "Switch the filter to see campaigns from other accounts, or create one in this account when the wizard ships."
          : demoMode
            ? "An admin needs to seed demo data first."
            : "The 6-step campaign create wizard ships next. Once it does, this list will fill up."}
      </p>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
