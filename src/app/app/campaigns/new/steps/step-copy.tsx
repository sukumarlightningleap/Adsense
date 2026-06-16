"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CampaignDraft } from "@/lib/wizard/schema";

type Props = {
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
};

export function StepCopy({ draft, onChange }: Props) {
  if (draft.channel === "PMAX") {
    return <PmaxCopy draft={draft} onChange={onChange} />;
  }
  return <SearchCopy draft={draft} onChange={onChange} />;
}

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------
function SearchCopy({ draft, onChange }: Props) {
  function update(patch: Partial<NonNullable<CampaignDraft["searchAdCopy"]>>) {
    onChange({
      ...draft,
      searchAdCopy: { ...draft.searchAdCopy!, ...patch },
    });
  }
  const c = draft.searchAdCopy!;

  return (
    <div className="space-y-6">
      <DynamicList
        label="Headlines"
        required
        helper="Google's Responsive Search Ads pick from these. 30 chars max. 3 minimum, 15 maximum."
        items={c.headlines}
        onChange={(headlines) => update({ headlines })}
        maxItems={15}
        maxLen={30}
        min={3}
        placeholder="Spark joy with our latest title"
      />
      <DynamicList
        label="Descriptions"
        required
        helper="Used as the second line of the ad. 90 chars max. 2 minimum, 4 maximum."
        items={c.descriptions}
        onChange={(descriptions) => update({ descriptions })}
        maxItems={4}
        maxLen={90}
        min={2}
        placeholder="Free shipping. 30-day returns. Read sample chapters now."
        multiline
      />
      <DynamicList
        label="Positive keywords"
        required
        helper="Phrases that trigger your ad. One per row."
        items={c.keywords}
        onChange={(keywords) => update({ keywords })}
        maxItems={500}
        maxLen={80}
        min={1}
        placeholder="ikigai book"
      />
      <DynamicList
        label="Negative keywords"
        helper="Phrases that should NOT trigger your ad."
        items={c.negativeKeywords ?? []}
        onChange={(negativeKeywords) => update({ negativeKeywords })}
        maxItems={500}
        maxLen={80}
        min={0}
        placeholder="free pdf"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PMAX
// ---------------------------------------------------------------------------
function PmaxCopy({ draft, onChange }: Props) {
  function update(patch: Partial<NonNullable<CampaignDraft["pmaxAdCopy"]>>) {
    onChange({
      ...draft,
      pmaxAdCopy: { ...draft.pmaxAdCopy!, ...patch },
    });
  }
  const c = draft.pmaxAdCopy!;

  return (
    <div className="space-y-6">
      {/* Business name — REQUIRED, single value */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="businessName" className="text-sm font-medium">
            Business name <span className="text-destructive">*</span>
          </Label>
          <span
            className={cn(
              "font-mono text-[11px]",
              c.businessName.length === 0
                ? "text-destructive"
                : c.businessName.length > 25
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
          >
            {c.businessName.length} / 25
          </span>
        </div>
        <Input
          id="businessName"
          value={c.businessName}
          onChange={(e) => update({ businessName: e.target.value })}
          maxLength={25}
          placeholder="Adsense Books"
          className="h-10"
        />
        <p className="text-[11.5px] text-muted-foreground">
          Shown on every PMAX placement. Max 25 characters.
        </p>
      </div>

      <DynamicList
        label="Short headlines"
        required
        helper="Used across Search, Display, Discover. 30 chars max. 3 minimum, 15 maximum."
        items={c.headlines}
        onChange={(headlines) => update({ headlines })}
        maxItems={15}
        maxLen={30}
        min={3}
        placeholder="Find your ikigai today"
      />

      <DynamicList
        label="Long headlines"
        required
        helper="Used for richer placements (Discover, YouTube). 90 chars max. 1 minimum, 5 maximum."
        items={c.longHeadlines}
        onChange={(longHeadlines) => update({ longHeadlines })}
        maxItems={5}
        maxLen={90}
        min={1}
        placeholder="Discover the Japanese secret to a long, joyful life — in 7 lessons."
        multiline
      />

      <DynamicList
        label="Descriptions"
        required
        helper="90 chars max. 2 minimum, 5 maximum."
        items={c.descriptions}
        onChange={(descriptions) => update({ descriptions })}
        maxItems={5}
        maxLen={90}
        min={2}
        placeholder="Free shipping. 30-day returns. Read sample chapters now."
        multiline
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared dynamic list component
// ---------------------------------------------------------------------------
function DynamicList({
  label,
  helper,
  items,
  onChange,
  maxItems,
  maxLen,
  min,
  required,
  placeholder,
  multiline,
}: {
  label: string;
  helper?: string;
  items: string[];
  onChange: (next: string[]) => void;
  maxItems: number;
  maxLen: number;
  min: number;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [draftValue, setDraftValue] = useState("");
  const InputEl = multiline ? Textarea : Input;

  function add() {
    const v = draftValue.trim();
    if (!v || v.length > maxLen) return;
    if (items.length >= maxItems) return;
    onChange([...items, v]);
    setDraftValue("");
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function update(i: number, v: string) {
    onChange(items.map((it, idx) => (idx === i ? v : it)));
  }

  const atMax = items.length >= maxItems;
  const belowMin = items.length < min;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label className="text-sm font-medium">
          {label}{" "}
          {required && <span className="text-destructive">*</span>}
        </Label>
        <span
          className={cn(
            "font-mono text-[11px]",
            belowMin
              ? "text-destructive"
              : atMax
                ? "text-amber-600"
                : "text-muted-foreground",
          )}
        >
          {items.length} / {maxItems}
          {min > 0 && ` · min ${min}`}
        </span>
      </div>
      {helper && (
        <p className="text-[11.5px] text-muted-foreground">{helper}</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <InputEl
                value={it}
                onChange={(e) => update(i, e.currentTarget.value)}
                maxLength={maxLen}
                rows={multiline ? 2 : undefined}
                className={multiline ? undefined : "h-9 text-[13px]"}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="mt-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <InputEl
          value={draftValue}
          onChange={(e) => setDraftValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (!multiline && e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          maxLength={maxLen}
          rows={multiline ? 2 : undefined}
          className={multiline ? undefined : "h-9 text-[13px]"}
          disabled={atMax}
        />
        <button
          type="button"
          onClick={add}
          disabled={atMax || !draftValue.trim()}
          className="mt-0 inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-[13px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
