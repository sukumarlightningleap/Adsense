import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import { getConversionHealthForAccount } from "@/lib/google-ads/health";

import { ConversionTrackingHub } from "./hub";

export const metadata = { title: "Conversion tracking" };

export default async function ConversionTrackingPage({
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
      demoMode: true,
      isManager: true,
      currencyCode: true,
      lastImportedAt: true,
    },
  });
  if (!account) notFound();
  if (demoMode !== account.demoMode) notFound();

  const healthRows = await getConversionHealthForAccount({ accountId: id });

  // Pull a few extra fields the health helper doesn't expose so the hub
  // can render source-badges + tagInstalled state + counting type.
  const extras = await db.conversionAction.findMany({
    where: { accountId: id },
    select: {
      id: true,
      source: true,
      tagInstalled: true,
      countingType: true,
      valueMicros: true,
      clickThroughLookbackDays: true,
    },
  });
  const extrasById = new Map(extras.map((e) => [e.id, e]));

  const rows = healthRows.map((h) => {
    const x = extrasById.get(h.id);
    return {
      ...h,
      source: (x?.source ?? "imported") as "created" | "imported",
      tagInstalled: x?.tagInstalled ?? false,
      countingType: x?.countingType ?? null,
      valueUsd: x?.valueMicros
        ? Number(x.valueMicros) / 1_000_000
        : null,
      lookbackDays: x?.clickThroughLookbackDays ?? null,
    };
  });

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
          Tracking hub
        </div>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Conversion tracking
        </h1>
        <p className="mt-3 text-pretty text-[14px] leading-7 text-muted-foreground">
          Every signal Google Ads can optimize against — leads, purchases,
          calls. Add one or use what&apos;s already running. Each campaign
          picks which of these counts as its primary goal.
        </p>
      </header>

      <ConversionTrackingHub
        accountId={id}
        accountName={account.descriptiveName ?? `Customer ${account.customerId}`}
        isManager={account.isManager}
        isDemo={account.demoMode}
        currencyCode={account.currencyCode ?? "USD"}
        rows={rows}
      />
    </div>
  );
}
