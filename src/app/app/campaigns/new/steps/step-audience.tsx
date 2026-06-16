"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SUPPORTED_COUNTRIES,
  type CampaignDraft,
  type CountryCode,
} from "@/lib/wizard/schema";

type Props = {
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
};

const SCOPES = [
  {
    value: "nationwide" as const,
    title: "Nationwide",
    body: "Target the whole country. Simplest, broadest reach.",
  },
  {
    value: "top_metros" as const,
    title: "Top metros",
    body: "Auto-pick the country's top metro areas. (Resolver wires up in Phase 4.)",
  },
  {
    value: "specific_cities" as const,
    title: "Specific cities",
    body: "Name your cities below. Geo resolver looks them up at launch.",
  },
];

export function StepAudience({ draft, onChange }: Props) {
  function update(patch: Partial<CampaignDraft["audience"]>) {
    onChange({ ...draft, audience: { ...draft.audience, ...patch } });
  }

  const [cityInput, setCityInput] = useState("");

  function addCity() {
    const v = cityInput.trim();
    if (!v) return;
    const cities = draft.audience.cities ?? [];
    if (cities.includes(v)) return;
    update({ cities: [...cities, v] });
    setCityInput("");
  }

  function removeCity(i: number) {
    const cities = draft.audience.cities ?? [];
    update({ cities: cities.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="country" className="text-sm font-medium">
          Country <span className="text-destructive">*</span>
        </Label>
        <select
          id="country"
          value={draft.audience.country}
          onChange={(e) =>
            update({ country: e.target.value as CountryCode })
          }
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Need a country not in this list? Add it to{" "}
          <code className="font-mono">src/lib/wizard/schema.ts</code>.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium">
          Targeting scope <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {SCOPES.map((s) => {
            const active = draft.audience.scope === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => update({ scope: s.value })}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-foreground bg-foreground/[0.04]"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`grid size-4 place-items-center rounded-full border ${
                      active
                        ? "border-foreground bg-foreground"
                        : "border-border"
                    }`}
                  >
                    {active && (
                      <span className="size-1.5 rounded-full bg-background" />
                    )}
                  </span>
                  <div className="text-[14px] font-semibold">{s.title}</div>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                  {s.body}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {draft.audience.scope === "specific_cities" && (
        <div className="space-y-3">
          <Label htmlFor="city" className="text-sm font-medium">
            Cities
          </Label>
          <div className="flex gap-2">
            <Input
              id="city"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCity();
                }
              }}
              placeholder="New York"
              className="h-10"
            />
            <button
              type="button"
              onClick={addCity}
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-[13px] font-medium hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Add
            </button>
          </div>
          {(draft.audience.cities?.length ?? 0) > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {draft.audience.cities!.map((c, i) => (
                <li
                  key={`${c}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px]"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => removeCity(i)}
                    className="rounded text-muted-foreground transition-colors hover:text-destructive"
                    aria-label={`Remove ${c}`}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Press Enter to add. Geo resolver looks them up against Google&apos;s
            geoTargetConstants at launch.
          </p>
        </div>
      )}
    </div>
  );
}
