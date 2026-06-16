"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CampaignDraft } from "@/lib/wizard/schema";

type Props = {
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
};

type SearchStrategy = NonNullable<
  CampaignDraft["searchBudget"]
>["biddingStrategy"];
type PmaxStrategy = NonNullable<CampaignDraft["pmaxBudget"]>["biddingStrategy"];

const SEARCH_STRATEGIES: {
  value: SearchStrategy;
  title: string;
  subtitle: string;
  good: string;
  warn?: string;
}[] = [
  {
    value: "MAXIMIZE_CLICKS",
    title: "Maximize Clicks",
    subtitle: "Spend your daily budget to get the most clicks possible.",
    good: "Default for new campaigns without conversion data.",
  },
  {
    value: "MAXIMIZE_CONVERSIONS",
    title: "Maximize Conversions",
    subtitle:
      "Smart bidding. Spend your budget on whatever Google thinks will convert.",
    good: "Best after 30+ conversions in the last 30 days.",
    warn: "Blind without conversion tracking — recheck before flipping it on.",
  },
  {
    value: "TARGET_CPA",
    title: "Target CPA",
    subtitle: "Hit a target cost-per-acquisition you set below.",
    good: "Use when you have a clear CPA threshold from past data.",
    warn: "Pauses if it can't hit the target — verify your target is realistic.",
  },
];

const PMAX_STRATEGIES: {
  value: PmaxStrategy;
  title: string;
  subtitle: string;
  good: string;
  warn?: string;
}[] = [
  {
    value: "MAXIMIZE_CONVERSIONS",
    title: "Maximize Conversions",
    subtitle: "Spend your budget on whatever Google thinks will convert.",
    good: "PMAX default. Best after 30+ conversions in the last 30 days.",
    warn: "PMAX requires conversion tracking. Won't function without it.",
  },
  {
    value: "MAXIMIZE_CONVERSION_VALUE",
    title: "Maximize Conversion Value",
    subtitle: "Bid for the most revenue, not just the most conversions.",
    good: "Use when conversion values vary (different SKUs, plans, tiers).",
    warn: "Requires conversion VALUES being tracked, not just events.",
  },
  {
    value: "TARGET_CPA",
    title: "Target CPA",
    subtitle: "Hit a target cost-per-acquisition you set below.",
    good: "Use when you have a clear CPA threshold from past data.",
  },
  {
    value: "TARGET_ROAS",
    title: "Target ROAS",
    subtitle: "Hit a target return on ad spend you set below.",
    good: "Use when revenue per conversion varies meaningfully.",
    warn: "Requires conversion values; needs ≥15 conversions in last 30 days.",
  },
];

export function StepBudget({ draft, onChange }: Props) {
  if (draft.channel === "PMAX") {
    return <PmaxBudget draft={draft} onChange={onChange} />;
  }
  return <SearchBudget draft={draft} onChange={onChange} />;
}

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------
function SearchBudget({ draft, onChange }: Props) {
  function update(patch: Partial<NonNullable<CampaignDraft["searchBudget"]>>) {
    onChange({
      ...draft,
      searchBudget: { ...draft.searchBudget!, ...patch },
    });
  }
  const b = draft.searchBudget!;

  return (
    <div className="space-y-6">
      <DailyBudgetField
        value={b.dailyUsd}
        onChange={(dailyUsd) => update({ dailyUsd })}
      />

      <StrategySelector
        label="Bidding strategy"
        current={b.biddingStrategy}
        options={SEARCH_STRATEGIES}
        onPick={(v) => update({ biddingStrategy: v as SearchStrategy })}
      />

      {b.biddingStrategy === "MAXIMIZE_CLICKS" && (
        <CapField
          id="maxCpc"
          label="Max CPC cap (optional)"
          value={b.maxCpcUsd}
          onChange={(v) => update({ maxCpcUsd: v })}
          placeholder="Leave blank for no cap"
          helper="Most agencies leave this blank and let Google bid freely."
        />
      )}

      {b.biddingStrategy === "TARGET_CPA" && (
        <CapField
          id="targetCpa"
          label="Target CPA"
          required
          value={b.targetCpaUsd}
          onChange={(v) => update({ targetCpaUsd: v })}
          placeholder="e.g. 25.00"
          helper="Google will pace bids to hit this cost per conversion on average."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PMAX
// ---------------------------------------------------------------------------
function PmaxBudget({ draft, onChange }: Props) {
  function update(patch: Partial<NonNullable<CampaignDraft["pmaxBudget"]>>) {
    onChange({
      ...draft,
      pmaxBudget: { ...draft.pmaxBudget!, ...patch },
    });
  }
  const b = draft.pmaxBudget!;

  return (
    <div className="space-y-6">
      <DailyBudgetField
        value={b.dailyUsd}
        onChange={(dailyUsd) => update({ dailyUsd })}
      />

      <StrategySelector
        label="Bidding strategy"
        current={b.biddingStrategy}
        options={PMAX_STRATEGIES}
        onPick={(v) => update({ biddingStrategy: v as PmaxStrategy })}
      />

      {(b.biddingStrategy === "TARGET_CPA" ||
        b.biddingStrategy === "MAXIMIZE_CONVERSIONS") && (
        <CapField
          id="targetCpa"
          label={
            b.biddingStrategy === "TARGET_CPA"
              ? "Target CPA"
              : "Target CPA (optional)"
          }
          required={b.biddingStrategy === "TARGET_CPA"}
          value={b.targetCpaUsd}
          onChange={(v) => update({ targetCpaUsd: v })}
          placeholder="e.g. 25.00"
          helper="USD per conversion."
        />
      )}

      {(b.biddingStrategy === "TARGET_ROAS" ||
        b.biddingStrategy === "MAXIMIZE_CONVERSION_VALUE") && (
        <RoasField
          required={b.biddingStrategy === "TARGET_ROAS"}
          value={b.targetRoas}
          onChange={(v) => update({ targetRoas: v })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------
function DailyBudgetField({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
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
            value={value}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
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
  );
}

function StrategySelector({
  label,
  current,
  options,
  onPick,
}: {
  label: string;
  current: string;
  options: {
    value: string;
    title: string;
    subtitle: string;
    good: string;
    warn?: string;
  }[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">
        {label} <span className="text-destructive">*</span>
      </Label>
      <div className="space-y-2">
        {options.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPick(opt.value)}
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
  );
}

function CapField({
  id,
  label,
  required,
  value,
  onChange,
  placeholder,
  helper,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder: string;
  helper: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-muted-foreground">
            $
          </span>
          <Input
            id={id}
            type="number"
            min={0.05}
            step={0.05}
            value={value ?? ""}
            onChange={(e) =>
              onChange(e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder={placeholder}
            className="h-10 pl-7 font-mono"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">{helper}</p>
      </div>
    </div>
  );
}

function RoasField({
  required,
  value,
  onChange,
}: {
  required: boolean;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="targetRoas" className="text-sm font-medium">
          Target ROAS
          {required && <span className="text-destructive"> *</span>}
        </Label>
        <Input
          id="targetRoas"
          type="number"
          min={0.1}
          step={0.1}
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          placeholder="e.g. 3.5 (= 350%)"
          className="h-10 font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          Value as a ratio: 1.0 = breakeven, 2.0 = 200% return, 3.5 = 350%.
        </p>
      </div>
    </div>
  );
}
