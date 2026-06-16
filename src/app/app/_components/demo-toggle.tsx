"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

type Props = {
  current: boolean; // true = demo
  setAction: (value: boolean) => Promise<void>;
};

/**
 * Segmented control for admins to flip between Live and Demo datasets.
 * Server-action-driven — clicking either pill calls `setAction` with the
 * target value, which sets the cookie and revalidates `/app`.
 */
export function DemoToggle({ current, setAction }: Props) {
  return (
    <div
      className="relative inline-flex items-center rounded-full border border-border bg-background p-0.5"
      role="group"
      aria-label="Dataset mode"
    >
      {/* Animated pill background */}
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className={cn(
          "absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full",
          current ? "bg-brand/15" : "bg-foreground/[0.07]",
        )}
        style={{ left: current ? "calc(50% + 0px)" : "2px" }}
      />

      <Pill active={!current} onClick={() => setAction(false)} label="Live" />
      <Pill active={current} onClick={() => setAction(true)} label="Demo" />
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <form action={onClick} className="contents">
      <button
        type="submit"
        className={cn(
          "relative z-10 inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
          active
            ? label === "Demo"
              ? "text-brand"
              : "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full transition-colors",
            label === "Demo"
              ? active
                ? "bg-brand"
                : "bg-muted-foreground/40"
              : active
                ? "bg-emerald-500"
                : "bg-muted-foreground/40",
          )}
        />
        {label}
      </button>
    </form>
  );
}
