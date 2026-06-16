"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Mail, ShieldCheck } from "lucide-react";

import { LogoMark } from "@/components/shared/logo";

/**
 * Forgot-password page — skeleton.
 *
 * Because Adsense has no public signup (admins create users), password
 * resets also flow through the admin. Two paths shown here:
 *
 *   1. Contact your team admin (default)
 *   2. Future — self-serve email reset (planned for Phase 7 / Auth.js OAuth)
 */
export function ForgotPasswordCard() {
  const reduce = useReducedMotion();
  const t = (delay: number) => ({
    duration: reduce ? 0 : 0.7,
    delay: reduce ? 0 : delay,
    ease: [0.22, 1, 0.36, 1] as const,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={t(0)}
      className="relative rounded-2xl border border-border bg-card/80 p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.18),0_8px_32px_-8px_rgba(0,0,0,0.06)] ring-1 ring-foreground/[0.03] backdrop-blur-md md:p-10"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.08)}
        className="flex flex-col items-center gap-5 text-center"
      >
        <Link
          href="/"
          aria-label="Adsense home"
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogoMark className="size-10 text-foreground" />
        </Link>
        <div>
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.025em]">
            Reset your password
          </h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Adsense accounts are managed by your team administrator. Reach
            out to them to reset your password.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.18)}
        className="mt-8 space-y-3"
      >
        <div className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-4">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Mail className="size-4" />
          </span>
          <div className="text-sm">
            <div className="font-medium">Contact your administrator</div>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Ask whoever invited you to Adsense to reset your password from
              their admin panel.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-background/30 p-4 opacity-70">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
            <ShieldCheck className="size-4" />
          </span>
          <div className="text-sm">
            <div className="font-medium">Self-serve reset</div>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Email-based password reset is coming with single sign-on
              support.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
