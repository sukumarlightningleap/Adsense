import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  label: string;
  /** Pre-formatted big value. */
  value: string;
  /**
   * Pre-formatted delta string (e.g. "+12.4%", "−$0.04"). Pass null if
   * there's no prior period to compare against.
   */
  delta: string | null;
  /** Direction the delta points. "up" = green, "down" = red, "flat" = muted. */
  direction: "up" | "down" | "flat" | null;
  /**
   * Whether "up" is GOOD for this metric. CPC and spend-per-conversion
   * are inverted (lower is better). Defaults to true (higher = good).
   */
  goodIsUp?: boolean;
};

export function KpiTile({
  label,
  value,
  delta,
  direction,
  goodIsUp = true,
}: Props) {
  const Icon =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : Minus;

  const good =
    direction === "flat" || direction === null
      ? false
      : goodIsUp
        ? direction === "up"
        : direction === "down";

  const bad =
    direction === "flat" || direction === null
      ? false
      : goodIsUp
        ? direction === "down"
        : direction === "up";

  const deltaColor = cn(
    "inline-flex items-center gap-0.5 font-mono text-[11px] font-medium",
    good && "text-emerald-600",
    bad && "text-destructive",
    !good && !bad && "text-muted-foreground",
  );

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] md:text-3xl">
        {value}
      </div>
      {delta && (
        <div className={cn("mt-1", deltaColor)}>
          <Icon className="size-3" />
          {delta}
          <span className="ml-1 text-muted-foreground/70">vs prior</span>
        </div>
      )}
    </div>
  );
}
