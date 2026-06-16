import Link from "next/link";
import type { Metadata } from "next";

import { SignInCard } from "./sign-in-card";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Adsense workspace.",
};

export default function SignInPage() {
  return (
    <div className="relative z-10 w-full max-w-md">
      <SignInCard />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link
          href="/"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <span aria-hidden>←</span>
          Back to home
        </Link>
      </p>
    </div>
  );
}
