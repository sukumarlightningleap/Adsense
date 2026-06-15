"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";

const steps = [
  {
    n: "01",
    title: "Connect your client's Google Ads account",
    body: "Link an MCC or a direct account via OAuth. Test and production credentials are kept apart — you can verify the entire pipeline against a test account before touching a real one.",
  },
  {
    n: "02",
    title: "Brief the campaign in plain English",
    body: "Describe the product, audience, budget, and geo. Adsense assembles a structured campaign payload with headlines, descriptions, keywords, and targeting suggestions.",
  },
  {
    n: "03",
    title: "Review every detail before launch",
    body: "Inspect each ad group, keyword, geo target, and bid strategy. Edit freely. Nothing pushes to Google until you explicitly approve it.",
  },
  {
    n: "04",
    title: "Launch — paused by default",
    body: "Adsense pushes the campaign to Google Ads as PAUSED. You verify in the Google UI, then enable when ready. No accidental live spend, ever.",
  },
];

export function Workflow() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 60%", "end 70%"],
  });
  const lineHeight = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section id="how" className="border-t border-border py-32 md:py-40">
      <div className="container-page">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl"
        >
          <div className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
            — How it works
          </div>
          <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.035em] md:text-6xl lg:text-7xl">
            Four steps.
            <br />
            <span className="text-muted-foreground">Brief to launched.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
            We mapped the agency workflow down to its essentials. No
            project-management overhead. No tab juggling. Just the steps
            that matter.
          </p>
        </motion.div>

        {/* Timeline */}
        <div ref={ref} className="relative mt-20 md:mt-24">
          {/* Vertical track */}
          <div
            aria-hidden
            className="absolute left-5 top-2 bottom-2 w-px bg-border md:left-7"
          />
          {/* Brand-filled progress */}
          <motion.div
            aria-hidden
            style={{ height: lineHeight }}
            className="absolute left-5 top-2 w-px bg-brand md:left-7"
          />

          <ol className="space-y-14 md:space-y-20">
            {steps.map((s, i) => (
              <Step key={s.n} step={s} index={i} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Step({
  step,
  index,
}: {
  step: { n: string; title: string; body: string };
  index: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{
        duration: 0.7,
        delay: index * 0.05,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="relative grid grid-cols-[3.5rem_1fr] gap-6 md:grid-cols-[5rem_1fr] md:gap-10"
    >
      <div className="relative flex justify-center">
        <div className="relative z-10 flex size-11 items-center justify-center rounded-full border border-border bg-background font-mono text-[12px] font-semibold tracking-tight md:size-14 md:text-sm">
          {step.n}
        </div>
      </div>
      <div className="pt-2.5 md:pt-3">
        <h3 className="text-balance text-2xl font-semibold tracking-[-0.025em] md:text-3xl lg:text-4xl">
          {step.title}
        </h3>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
          {step.body}
        </p>
      </div>
    </motion.li>
  );
}
