import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";

import { Wizard } from "./wizard";

export const metadata = {
  title: "New campaign",
};

export default async function NewCampaignPage() {
  const session = await auth();
  const user = session!.user;

  // Demo users can browse but not create.
  if (user.role === "demo") {
    redirect("/app/campaigns");
  }

  // Live accounts only — the wizard saves real campaigns. (You can't
  // attach a real campaign to a demo account.)
  const accounts = await db.adsAccount.findMany({
    where: { userId: user.id, demoMode: false },
    select: {
      id: true,
      descriptiveName: true,
      customerId: true,
      currencyCode: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="container-page py-12 md:py-16">
      <Link
        href="/app/campaigns"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Campaigns
      </Link>

      <header className="mt-5 max-w-3xl">
        <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          <span className="size-1 rounded-full bg-brand" />
          New campaign · SEARCH
        </div>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Build a campaign
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
          Five steps. Everything stays a paused draft until you launch it
          from the detail page. You can leave and come back — your progress
          is saved in this browser.
        </p>
      </header>

      <div className="mt-10">
        {accounts.length === 0 ? (
          <NoAccountsEmpty />
        ) : (
          <Wizard
            accounts={accounts.map((a) => ({
              id: a.id,
              name: a.descriptiveName ?? `Customer ${a.customerId}`,
              customerId: a.customerId,
              currencyCode: a.currencyCode ?? "USD",
            }))}
          />
        )}
      </div>
    </div>
  );
}

function NoAccountsEmpty() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">
        You haven&apos;t connected an account yet
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-muted-foreground">
        A campaign has to live inside a Google Ads customer account.
        Connect one first.
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          href="/app/accounts/new"
          className="inline-flex h-10 items-center gap-1.5 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/80"
        >
          Connect an account
        </Link>
      </div>
    </div>
  );
}
