import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { ConnectAccountForm } from "./connect-account-form";

export const metadata = {
  title: "Connect account",
};

export default async function ConnectAccountPage() {
  const session = await auth();
  // Demo users can browse but not create live accounts.
  if (session?.user?.role === "demo") {
    redirect("/app/accounts");
  }

  return (
    <div className="container-page py-12 md:py-16">
      <Link
        href="/app/accounts"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Accounts
      </Link>

      <header className="mt-5 max-w-2xl">
        <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          <span className="size-1 rounded-full bg-brand" />
          Connect account
        </div>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Connect a Google Ads account
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
          Enter the customer ID for the account you want Adsense to manage.
          You can rename it any time.
        </p>
      </header>

      <section className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-8">
        <ConnectAccountForm />
      </section>
    </div>
  );
}
