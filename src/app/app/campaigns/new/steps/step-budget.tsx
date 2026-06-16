"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CampaignDraft } from "@/lib/wizard/schema";

type Props = {
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
};

type Strategy = CampaignDraft["budget"]["biddingStrategy"];

const STRATEGIES: {
  value: Strategy;
  title: string;
  subtitle: string;
  hint: string;
  good: string;
  warn?: string;
}[] = [
  {
    value: "MAXIMIZE_CLICKS",
    title: "Maximize Clicks",
    subtitle: "Spend your daily budget to get the most clicks possible.",
    hint: "Optional max CPC cap below.",
    good: "Default for new campaigns without conversion data.",
  },
  {
    value: "MAXIMIZE_CONVERSIONS",
    title: "Maximize Conversions",
    subtitle:
      "Smart bidding. Spend your budget on whatever Google thinks will convert.",
    hint: "Requires conversion tracking to be live and accurate.",
    good: "Best after 30+ conversions in the last 30 days.",
    warn: "Blind without conversion tracking — recheck before flipping it on.",
  },
  {
    value: "TARGET_CPA",
    title: "Target CPA",
    subtitle:
      "Smart bidding. Hit a target cost-per-acquisition you set below.",
    hint: "Target value required.",
    good: "Use when you have a clear CPA threshold from past data.",
    warn: "Will pause spending if it can't hit the target — verify your target is realistic.",
  },
];

export function StepBudget({ draft, onChange }: Props) {
  function update(patch: Partial<CampaignDraft["budget"]>) {
    onChange({ ...draft, budget: { ...draft.budget, ...patch } });
  }

  const s = draft.budget.biddingStrategy;

  return (
    <div className="space-y-6">
      {/* Daily budget */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dailyUsd" className="text-sm font-medium">
            Daily budget <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-muted-foreground">
              $
            </span>
            <Input
              id="dailyUsd"
              type="number"
              min={1}
              step={1}
              value={draft.budget.dailyUsd}
              onChange={(e) =>
                update({ dailyUsd: Number(e.target.value) || 0 })
              }
              className="h-10 pl-7 font-mono"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground">
              / day
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Google may spend up to 2× this on any given day, but never more
            than 30.4× per month.
          </p>
        </div>
      </div>

      {/* Bidding strategy */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">
          Bidding strategy <span className="text-destructive">*</span>
        </Label>
        <div className="space-y-2">
          {STRATEGIES.map((opt) => {
            const active = s === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ biddingStrategy: opt.value })}
                className={cn(
                  "block w-full rounded-xl border p-4 text-left transition-colors",
                  active
                    ? "border-foreground bg-foreground/[0.04]"
                    : "border-border bg-card hover:bg-muted/40",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 place-items-center rounded-full border",
                      active
                        ? "border-foreground bg-foreground"
                        : "border-border",
                    )}
                  >
                    {active && (
                      <span className="size-1.5 rounded-full bg-background" />
                    )}
                  </span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-[14px] font-semibold">
                        {opt.title}
                      </div>
                      <code className="font-mono text-[10px] text-muted-foreground">
                        {opt.value}
                      </code>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                      {opt.subtitle}
                    </p>
                    <ul className="mt-2 space-y-1 text-[11.5px]">
                      <li className="text-emerald-700">✓ {opt.good}</li>
                      {opt.warn && (
                        <li className="text-amber-700">⚠ {opt.warn}</li>
                      )}
                    </ul>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Strategy-specific extras */}
      {s === "MAXIMIZE_CLICKS" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="maxCpc" className="text-sm font-medium">
              Max CPC cap (optional)
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-muted-foreground">
                $
              </span>
              <Input
                id="maxCpc"
                type="number"
                min={0.05}
                step={0.05}
                value={draft.budget.maxCpcUsd ?? ""}
                onChange={(e) =>
                  update({
                    maxCpcUsd: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                placeholder="Leave blank for no cap"
                className="h-10 pl-7 font-mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Most agencies leave this blank and let Google bid freely.
            </p>
          </div>
        </div>
      )}

      {s === "TARGET_CPA" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="targetCpa" className="text-sm font-medium">
              Target CPA <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-muted-foreground">
                $
              </span>
              <Input
                id="targetCpa"
                type="number"
                min={0.1}
                step={0.1}
                value={draft.budget.targetCpaUsd ?? ""}
                onChange={(e) =>
                  update({
                    targetCpaUsd: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                placeholder="e.g. 25.00"
                className="h-10 pl-7 font-mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Google will pace bids to hit this cost per conversion on
              average.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
