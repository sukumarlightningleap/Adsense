import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import { getAccountsList, type AccountListRow } from "@/lib/dashboard/kpis";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Accounts",
};

export default async function AccountsPage() {
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);
  const rows = await getAccountsList({
    userId: user.id,
    demoMode,
    windowDays: 7,
  });

  // demo users browse only; admins + members can connect live accounts.
  const canConnect = user.role !== "demo";

  return (
    <div className="container-page py-12 md:py-16">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
            <span className="size-1 rounded-full bg-brand" />
            Accounts · {demoMode ? "Demo data" : "Live data"}
          </div>
          <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
            Connected accounts
          </h1>
          <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
            Every Google Ads customer account under management.
            {demoMode &&
              " (Demo accounts shown — toggle to Live to see real ones.)"}
          </p>
        </div>
        {canConnect && !demoMode && (
          <Button render={<Link href="/app/accounts/new" />}>
            <Plus />
            Connect account
          </Button>
        )}
      </header>

      {/* Body */}
      <div className="mt-10">
        {rows.length === 0 ? (
          <EmptyState canConnect={canConnect} demoMode={demoMode} />
        ) : (
          <AccountsTable rows={rows} demoMode={demoMode} />
        )}
      </div>
    </div>
  );
}

function AccountsTable({
  rows,
  demoMode,
}: {
  rows: AccountListRow[];
  demoMode: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/30 px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <div className="col-span-4">Account</div>
        <div className="col-span-2">Customer ID</div>
        <div className="col-span-1">GA4</div>
        <div className="col-span-1 text-right">Campaigns</div>
        <div className="col-span-1 text-right">Clicks 7d</div>
        <div className="col-span-2 text-right">Spend 7d</div>
        <div className="col-span-1 text-right">—</div>
      </div>
      {rows.map((a) => (
        <div
          key={a.id}
          className="grid grid-cols-12 items-center gap-3 border-b border-border px-5 py-4 last:border-b-0 transition-colors hover:bg-muted/30"
        >
          <div className="col-span-4 min-w-0">
            <Link
              href={`/app/accounts/${a.id}`}
              className="block truncate text-[14px] font-medium hover:text-brand"
            >
              {a.descriptiveName}
            </Link>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {a.currencyCode ?? "—"} · {a.timeZone ?? "—"}
            </div>
          </div>
          <div className="col-span-2 font-mono text-[12px] text-muted-foreground">
            {formatCustomerId(a.customerId)}
            {a.loginCustomerId && (
              <div className="text-[10px] text-muted-foreground/70">
                via MCC {formatCustomerId(a.loginCustomerId)}
              </div>
            )}
          </div>
          <div className="col-span-1">
            <Ga4Badge linked={a.ga4Linked} />
          </div>
          <div className="col-span-1 text-right font-mono text-[12px] tabular-nums">
            {a.campaignCount}
          </div>
          <div className="col-span-1 text-right font-mono text-[12px] tabular-nums">
            {compact(a.recent.clicks)}
          </div>
          <div className="col-span-2 text-right font-mono text-[12px] font-medium tabular-nums">
            ${a.recent.spendUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
          <div className="col-span-1 flex items-center justify-end gap-2">
            {demoMode && (
              <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet-700">
                DEMO
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Ga4Badge({ linked }: { linked: boolean | null }) {
  if (linked === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Linked
      </span>
    );
  if (linked === false)
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        Not linked
      </span>
    );
  return <span className="text-[11px] text-muted-foreground">—</span>;
}

function EmptyState({
  canConnect,
  demoMode,
}: {
  canConnect: boolean;
  demoMode: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
      <div className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
        <Building2 className="size-5" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        {demoMode
          ? "No demo accounts yet"
          : "No Google Ads accounts connected"}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-muted-foreground">
        {demoMode
          ? "An admin needs to seed demo data first."
          : "Connect your first customer account to start tracking impressions, clicks, spend, and conversions."}
      </p>
      {!demoMode && canConnect && (
        <div className="mt-6 flex justify-center">
          <Button render={<Link href="/app/accounts/new" />}>
            <Plus />
            Connect an account
          </Button>
        </div>
      )}
      {demoMode && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            render={<Link href="/app/admin/demo" />}
          >
            Go to demo data
          </Button>
        </div>
      )}
    </div>
  );
}

function formatCustomerId(id: string): string {
  // Render Google's XXX-XXX-XXXX for any 10-digit customer ID.
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
