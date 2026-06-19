import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flame,
  HelpCircle,
  XCircle,
} from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import {
  getAdGroupBleedForAccount,
  getConversionHealthForAccount,
  type AdGroupBleedStatus,
  type ConversionHealthStatus,
} from "@/lib/google-ads/health";
import { cn } from "@/lib/utils";

import { RepairConversionButton } from "./repair-button";

export const metadata = { title: "Health" };

export default async function AccountHealthPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);

  const account = await db.adsAccount.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      descriptiveName: true,
      customerId: true,
      lastImportedAt: true,
      demoMode: true,
    },
  });
  if (!account) notFound();
  if (demoMode !== account.demoMode) notFound();

  const [conversions, bleeders] = await Promise.all([
    getConversionHealthForAccount({ accountId: id }),
    getAdGroupBleedForAccount({ accountId: id }),
  ]);

  return (
    <div className="container-page py-12 md:py-16">
      <Link
        href={`/app/accounts/${id}`}
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {account.descriptiveName ?? "Account"}
      </Link>

      <header className="mt-5 max-w-2xl">
        <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          <span className="size-1 rounded-full bg-brand" />
          Health audit
        </div>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          What&apos;s working, what&apos;s not
        </h1>
        <p className="mt-3 text-pretty text-[14px] leading-7 text-muted-foreground">
          Two checks run every 24 hours after import: are your conversion
          tags still firing, and is any ad group bleeding spend without
          producing results?
        </p>
        {!account.lastImportedAt && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-800">
            No import has run yet. Go to the account page and click Import
            now — the audit will populate within seconds.
          </p>
        )}
      </header>

      {/* Conversion-action health */}
      <section className="mt-10">
        <h2 className="text-[16px] font-semibold tracking-tight">
          Conversion tracking
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Each conversion action your account is configured with, and
          whether it&apos;s firing.
        </p>

        {conversions.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-card/40 px-5 py-8 text-center text-[13px] text-muted-foreground">
            No conversion actions imported. Run an import from the account
            page first.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {conversions.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-border bg-card p-4 md:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <ConvHealthIcon status={c.health} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[14px] font-semibold">
                          {c.name}
                        </span>
                        {c.isPrimary && (
                          <span className="rounded border border-border bg-muted/40 px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            Primary
                          </span>
                        )}
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {c.category}
                        </span>
                      </div>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">
                        {c.reason}
                      </p>
                    </div>
                  </div>
                  {c.health === "broken" && (
                    <RepairConversionButton conversionId={c.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Ad-group bleed signals */}
      <section className="mt-12">
        <h2 className="text-[16px] font-semibold tracking-tight">
          Ad-group performance (last 7 days)
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          We split campaign spend by ad group and compare each one against
          the campaign baseline. Bleeders should be paused or reworked.
        </p>

        {bleeders.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-card/40 px-5 py-8 text-center text-[13px] text-muted-foreground">
            No ad groups synced yet. Performance signals appear after the
            daily sync runs.
          </p>
        ) : (
          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/30 px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <div className="col-span-5">Ad group</div>
              <div className="col-span-2 text-right">Spend 7d</div>
              <div className="col-span-1 text-right">Conv</div>
              <div className="col-span-2 text-right">CPA</div>
              <div className="col-span-2">Status</div>
            </div>
            {bleeders.map((b) => (
              <div
                key={b.id}
                className="grid grid-cols-12 items-center gap-3 border-b border-border px-5 py-3 last:border-b-0"
              >
                <div className="col-span-5 min-w-0">
                  <div className="truncate text-[13px] font-medium">
                    {b.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {b.campaignName}
                    {b.themeLabel && ` · ${b.themeLabel}`}
                  </div>
                </div>
                <div className="col-span-2 text-right font-mono text-[12px] tabular-nums">
                  ${b.spend7dUsd.toFixed(2)}
                </div>
                <div className="col-span-1 text-right font-mono text-[12px] tabular-nums">
                  {b.conversions7d.toFixed(0)}
                </div>
                <div className="col-span-2 text-right font-mono text-[12px] tabular-nums">
                  {b.cpa7dUsd != null ? `$${b.cpa7dUsd.toFixed(2)}` : "—"}
                </div>
                <div className="col-span-2">
                  <BleedBadge status={b.status} reason={b.reason} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ConvHealthIcon({ status }: { status: ConversionHealthStatus }) {
  const map = {
    working: {
      bg: "bg-emerald-500/15 text-emerald-700",
      icon: <CheckCircle2 className="size-4" />,
    },
    stale: {
      bg: "bg-amber-500/15 text-amber-700",
      icon: <Clock className="size-4" />,
    },
    broken: {
      bg: "bg-destructive/15 text-destructive",
      icon: <XCircle className="size-4" />,
    },
    inactive: {
      bg: "bg-muted text-muted-foreground",
      icon: <HelpCircle className="size-4" />,
    },
  } as const;
  const c = map[status];
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md",
        c.bg,
      )}
    >
      {c.icon}
    </span>
  );
}

function BleedBadge({
  status,
  reason,
}: {
  status: AdGroupBleedStatus;
  reason: string;
}) {
  if (status === "no_data") {
    return (
      <span className="text-[11px] text-muted-foreground" title={reason}>
        No data
      </span>
    );
  }
  const map = {
    bleeding: {
      bg: "border-destructive/30 bg-destructive/[0.08] text-destructive",
      icon: <Flame className="size-3" />,
      label: "Bleeding",
    },
    underperforming: {
      bg: "border-amber-500/30 bg-amber-500/[0.08] text-amber-800",
      icon: <AlertTriangle className="size-3" />,
      label: "Watch",
    },
    ok: {
      bg: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700",
      icon: <CheckCircle2 className="size-3" />,
      label: "OK",
    },
  } as const;
  const c = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold",
        c.bg,
      )}
      title={reason}
    >
      {c.icon}
      {c.label}
    </span>
  );
}
