"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Landing hero — big, alive, opinionated.
 *
 * Effects:
 *  - Mouse-tracking radial spotlight in brand color
 *  - Hero headline staggered fade-up
 *  - Preview card: continuous gentle float + 3D parallax tilt on cursor
 *  - Live "running campaigns" pulse dot in brand color
 *
 * Everything respects prefers-reduced-motion.
 */
export function Hero() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  // ---- mouse-follow spotlight ------------------------------------------
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const spotlight = useMotionTemplate`radial-gradient(560px circle at ${mouseX}px ${mouseY}px, color-mix(in oklch, var(--brand) 22%, transparent), transparent 70%)`;

  function handleMove(e: React.MouseEvent<HTMLElement>) {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  // ---- ease ------------------------------------------------------------
  const t = (delay: number, dur = 1) => ({
    duration: reduce ? 0 : dur,
    delay: reduce ? 0 : delay,
    ease: [0.22, 1, 0.36, 1] as const,
  });

  return (
    <section
      ref={sectionRef}
      onMouseMove={handleMove}
      className="relative overflow-hidden pt-28 pb-32 md:pt-36 md:pb-44"
    >
      {/* Mouse spotlight */}
      <motion.div
        aria-hidden
        style={{ background: spotlight }}
        className="pointer-events-none absolute inset-0 -z-10"
      />
      {/* Dot grid backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-grid-dotted mask-radial-fade opacity-70"
      />
      {/* Brand ambient orb top-right */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={t(0.6, 2)}
        className="absolute -top-32 right-1/2 -z-10 size-[640px] translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)] blur-2xl"
      />

      <div className="container-page text-center">
        {/* Eyebrow pill */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0, 0.8)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur-sm shadow-sm"
        >
          <Sparkles className="size-3.5 text-brand" />
          Built for agencies running Google Ads at scale
        </motion.div>

        {/* Massive display headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0.12, 1.1)}
          className="mx-auto mt-8 max-w-[16ch] text-balance text-5xl font-semibold leading-[1] tracking-[-0.04em] md:max-w-[18ch] md:text-7xl lg:text-8xl"
        >
          Launch ads{" "}
          <span className="relative inline-block">
            <span className="relative z-10 italic font-medium" style={{
              fontFamily: "var(--font-mono), ui-monospace",
              letterSpacing: "-0.05em",
              color: "var(--brand)",
            }}>
              faster
            </span>
            <motion.svg
              aria-hidden
              viewBox="0 0 240 18"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ ...t(0.9, 1.4) }}
              className="absolute -bottom-2 left-0 h-3 w-full md:-bottom-3 md:h-5"
              fill="none"
            >
              <motion.path
                d="M3 12 C 60 4, 120 18, 237 6"
                stroke="var(--brand)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </motion.svg>
          </span>
          ,
          <br className="hidden sm:block" /> than your competitors.
        </motion.h1>

        {/* Subhead */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0.3, 0.9)}
          className="mx-auto mt-10 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground md:text-xl md:leading-9"
        >
          Adsense builds, launches, and tracks Google Ads campaigns end-to-end.
          Six guided steps. One dashboard. Full control over every keyword,
          asset, and bid.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0.42, 0.9)}
          className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button
            size="lg"
            render={<Link href="/sign-up" />}
            className="h-12 px-6 text-base"
          >
            Start launching
            <ArrowUpRight />
          </Button>
          <Button
            size="lg"
            variant="outline"
            render={<Link href="#how" />}
            className="h-12 px-6 text-base"
          >
            See how it works
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(0.55, 0.9)}
          className="mt-6 text-sm text-muted-foreground"
        >
          Free 14-day trial · No credit card required
        </motion.p>
      </div>

      {/* Floating preview card */}
      <motion.div
        initial={{ opacity: 0, y: 80 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.5, 1.4)}
        className="container-page mt-24 md:mt-28"
      >
        <FloatingPreview reduce={!!reduce} />
      </motion.div>
    </section>
  );
}

/**
 * Floating, mouse-tilting product preview card. Continuous Y bobbing
 * (respects reduce-motion) + 3D rotateX/rotateY tied to cursor over the card.
 */
function FloatingPreview({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rxRaw = useTransform(my, [0, 1], [6, -6]);
  const ryRaw = useTransform(mx, [0, 1], [-6, 6]);
  const rx = useSpring(rxRaw, { stiffness: 120, damping: 14 });
  const ry = useSpring(ryRaw, { stiffness: 120, damping: 14 });

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width);
    my.set((e.clientY - rect.top) / rect.height);
  }
  function onLeave() {
    mx.set(0.5);
    my.set(0.5);
  }

  return (
    <div className="relative mx-auto max-w-6xl" style={{ perspective: 1400 }}>
      {/* floor glow */}
      <div
        aria-hidden
        className="absolute -inset-x-16 -bottom-12 h-40 rounded-full bg-foreground/[0.08] blur-3xl"
      />
      <motion.div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        animate={reduce ? undefined : { y: [0, -8, 0] }}
        transition={
          reduce
            ? undefined
            : { duration: 6, repeat: Infinity, ease: "easeInOut" }
        }
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_40px_120px_-30px_rgba(0,0,0,0.22),0_12px_40px_-12px_rgba(0,0,0,0.10)] ring-1 ring-foreground/5"
      >
        {/* faux window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-5 py-3.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="ml-4 font-mono text-[12px] font-medium text-muted-foreground">
            adsense.app / campaigns / oxford-dictionary
          </span>
        </div>

        <div className="grid grid-cols-12">
          {/* sidebar */}
          <aside className="col-span-3 hidden border-r border-border p-5 md:block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Workspace
            </div>
            <div className="mt-3 space-y-1">
              {[
                ["Overview", false],
                ["Campaigns", true],
                ["Accounts", false],
                ["Assets", false],
                ["Reports", false],
                ["Settings", false],
              ].map(([label, active]) => (
                <div
                  key={label as string}
                  className={`rounded-md px-3 py-2 text-[13px] ${
                    active
                      ? "bg-foreground/[0.06] font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {label as string}
                </div>
              ))}
            </div>
          </aside>

          {/* main */}
          <main className="col-span-12 p-6 md:col-span-9 md:p-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Active campaign
                </div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  Oxford English Mini Dictionary — SEARCH
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium">
                <motion.span
                  className="size-2 rounded-full bg-brand"
                  animate={
                    reduce
                      ? undefined
                      : { scale: [1, 1.4, 1], opacity: [1, 0.55, 1] }
                  }
                  transition={
                    reduce
                      ? undefined
                      : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
                  }
                />
                Live · United States
              </div>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { k: "Impressions", v: "284,112", d: "+12.4%" },
                { k: "Clicks", v: "12,488", d: "+18.2%" },
                { k: "CTR", v: "4.39%", d: "+0.6pt" },
                { k: "Avg CPC", v: "$0.62", d: "-$0.04" },
              ].map((m) => (
                <div
                  key={m.k}
                  className="rounded-xl border border-border bg-background p-4"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.k}
                  </div>
                  <div className="mt-1.5 text-lg font-semibold tracking-tight">
                    {m.v}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {m.d} vs prior
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-border bg-background p-5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Last 14 days · Clicks trend
                </div>
                <div className="text-[11px] font-medium text-brand">+18.2%</div>
              </div>
              <div className="mt-4 flex h-24 items-end gap-1.5">
                {[18, 26, 22, 34, 30, 38, 44, 36, 48, 52, 46, 58, 64, 72].map(
                  (h, i) => (
                    <motion.div
                      key={i}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{
                        duration: reduce ? 0 : 0.6,
                        delay: reduce ? 0 : 1.2 + i * 0.04,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      style={{ originY: 1, height: `${h}%` }}
                      className={`flex-1 rounded-sm ${
                        i === 13 ? "bg-brand" : "bg-foreground/80"
                      }`}
                    />
                  ),
                )}
              </div>
            </div>
          </main>
        </div>
      </motion.div>
    </div>
  );
}
