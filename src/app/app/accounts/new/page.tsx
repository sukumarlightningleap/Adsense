import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
          Sign in with the Google account that owns or manages the Google Ads
          account. We&apos;ll mirror your campaigns, ad groups, keywords,
          assets, and conversion actions so you can manage everything here.
        </p>
      </header>

      {/* Primary path — OAuth. Recommended for real customers. */}
      <section className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-foreground text-background">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Connect with Google
            </h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              We&apos;ll ask Google for read + write access to the Ads accounts
              you authorize. Nothing is changed in Google until you click
              Launch from Adsense. You can revoke any time at{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                myaccount.google.com/permissions
              </a>
              .
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href="/api/google-ads/oauth/start?returnTo=/app/accounts"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-5 text-[13.5px] font-medium text-background transition-colors hover:bg-foreground/85"
          >
            <GoogleGlyph />
            Connect with Google
          </a>
          <span className="text-[11.5px] text-muted-foreground">
            Scope requested: <code className="font-mono">adwords</code>
          </span>
        </div>
      </section>

      {/* Advanced — manual customer-id entry. Useful for sandbox / dev. */}
      <details className="mt-6">
        <summary className="cursor-pointer text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
          Advanced — add manually by customer ID
        </summary>
        <section className="mt-3 rounded-2xl border border-border bg-card p-6 md:p-8">
          <ConnectAccountForm />
        </section>
      </details>
    </div>
  );
}

/** Inline Google "G" — keeps the OAuth button visually anchored. */
function GoogleGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.78 32.715 29.282 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.155 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.155 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.262 0-9.747-3.263-11.283-7.946l-6.514 5.025C9.5 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
