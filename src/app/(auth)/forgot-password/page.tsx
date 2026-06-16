import Link from "next/link";
import type { Metadata } from "next";

import { ForgotPasswordCard } from "./forgot-password-card";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Reset your Adsense password.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="relative z-10 w-full max-w-md">
      <ForgotPasswordCard />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <span aria-hidden>←</span>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
