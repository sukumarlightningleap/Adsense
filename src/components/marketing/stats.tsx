"use client";

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

const stats = [
  { value: 12, suffix: "M+", label: "Ad spend managed" },
  { value: 1400, suffix: "+", label: "Campaigns launched" },
  { value: 85, suffix: "%", label: "Avg time saved" },
  { value: 200, suffix: "+", label: "Connected accounts" },
];

export function Stats() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="container-page py-16 md:py-20">
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 md:gap-x-8">
          {stats.map((s, i) => (
            <Stat key={s.label} {...s} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({
  value,
  suffix,
  label,
  index,
}: {
  value: number;
  suffix: string;
  label: string;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  const reduce = useReducedMotion();

  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) =>
    Math.round(v).toLocaleString("en-US"),
  );

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
      delay: 0.05 + index * 0.08,
    });
    return () => controls.stop();
  }, [inView, value, count, reduce, index]);

  return (
    <div ref={ref}>
      <div className="flex items-baseline">
        <motion.span className="text-5xl font-semibold tracking-[-0.04em] md:text-6xl lg:text-7xl">
          {rounded}
        </motion.span>
        <span className="text-3xl font-semibold tracking-[-0.04em] text-brand md:text-4xl lg:text-5xl">
          {suffix}
        </span>
      </div>
      <div className="mt-3 text-sm font-medium text-muted-foreground md:text-base">
        {label}
      </div>
    </div>
  );
}
