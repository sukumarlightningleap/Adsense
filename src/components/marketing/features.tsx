"use client";

import { motion } from "motion/react";
import {
  Zap,
  ImageIcon,
  Target,
  LayoutGrid,
  GitBranch,
  Gauge,
} from "lucide-react";

type Feat = {
  icon: typeof Zap;
  title: string;
  body: string;
  /** Tailwind col-span / row-span classes — bento layout */
  span?: string;
  tone?: "default" | "feature";
};

const features: Feat[] = [
  {
    icon: Zap,
    title: "Unified launcher",
    body: "One guided flow for SEARCH, Performance Max, and Display. Six steps from brief to live — every detail editable, every change auditable.",
    span: "md:col-span-2 md:row-span-2",
    tone: "feature",
  },
  {
    icon: ImageIcon,
    title: "Creative on demand",
    body: "Generate ad headlines, descriptions, and image posters sized for every Google Ads aspect ratio.",
  },
  {
    icon: Target,
    title: "Drop-in conversion tag",
    body: "Generate a tag snippet for your client's site. No GA4 dependency.",
  },
  {
    icon: LayoutGrid,
    title: "Multi-account control",
    body: "MCC-aware dashboard manages every client account from one place. Switch context in a single click. Test and prod credentials kept separate.",
    span: "md:col-span-2",
  },
  {
    icon: GitBranch,
    title: "Ad-group strategy",
    body: "Structure each campaign with multiple ad groups — keyword themes, audience splits, and bid tiers.",
  },
  {
    icon: Gauge,
    title: "Strategy-aware bidding",
    body: "Maximize Clicks, Target CPA, or Maximize Conversions — chosen with awareness of conversion tracking state.",
  },
];

export function Features() {
  return (
    <section id="features" className="py-32 md:py-40">
      <div className="container-page">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl"
        >
          <div className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
            — Features
          </div>
          <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.035em] md:text-6xl lg:text-7xl">
            Everything you need to run Google Ads.
            <span className="text-muted-foreground"> Nothing you don&apos;t.</span>
          </h2>
        </motion.div>

        <div className="mt-16 grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
  span,
  tone,
  index,
}: Feat & { index: number }) {
  const isHero = tone === "feature";
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{
        duration: 0.65,
        delay: index * 0.05,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -4 }}
      className={`group relative overflow-hidden rounded-2xl border border-border bg-card p-7 transition-shadow hover:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.18)] md:p-9 ${span ?? ""}`}
    >
      {/* hover spotlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), color-mix(in oklch, var(--brand) 12%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <div
            className={`inline-flex size-11 items-center justify-center rounded-xl ${
              isHero ? "bg-brand text-brand-foreground" : "bg-foreground text-background"
            }`}
          >
            <Icon className="size-5" />
          </div>
          {isHero && (
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-brand">
              Core
            </span>
          )}
        </div>

        <h3
          className={`mt-6 font-semibold tracking-[-0.02em] ${
            isHero ? "text-2xl md:text-3xl" : "text-xl"
          }`}
        >
          {title}
        </h3>
        <p
          className={`mt-3 leading-7 text-muted-foreground ${
            isHero ? "text-base md:text-[17px]" : "text-[15px]"
          }`}
        >
          {body}
        </p>

        {isHero && (
          <div className="mt-auto pt-8">
            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <span className="size-1.5 rounded-full bg-brand" />
                Launch preview
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                {["Brief", "Targeting", "Creative", "Bidding", "Review", "Launch"].map(
                  (step, idx) => (
                    <div
                      key={step}
                      className={`rounded-md border border-border bg-card px-2.5 py-1.5 text-center ${
                        idx <= 3
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {idx + 1}. {step}
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
