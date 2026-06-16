"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/shared/logo";

import { SignInForm } from "./sign-in-form";

/**
 * Wrapper card with the staggered motion entrance. Split out from page.tsx
 * so the page itself stays a Server Component (faster, less client JS).
 */
export function SignInCard() {
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
      {/* Logo + headline */}
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
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your Adsense workspace.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.18)}
        className="mt-10"
      >
        <SignInForm />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={t(0.32)}
        className="mt-8 text-center text-xs text-muted-foreground"
      >
        New here? Accounts are created by your administrator.
      </motion.p>
    </motion.div>
  );
}
