"use client";

import { Megaphone, Sparkles } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CampaignDraft, Channel } from "@/lib/wizard/schema";

import type { AccountOption } from "../wizard";

type Props = {
  accounts: AccountOption[];
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
};

const CHANNEL_OPTIONS: {
  value: Channel;
  title: string;
  subtitle: string;
  icon: typeof Megaphone;
  good: string;
  warn?: string;
}[] = [
  {
    value: "SEARCH",
    title: "Search",
    subtitle:
      "Responsive Search Ads on Google Search. Keyword-targeted, text-only.",
    icon: Megaphone,
    good: "Lowest barrier — no images needed, no conversion tracking required.",
  },
  {
    value: "PMAX",
    title: "Performance Max",
    subtitle:
      "AI-driven, multi-channel (Search + Display + YouTube + Discover + Gmail).",
    icon: Sparkles,
    good: "Best for proven products with strong conversion data.",
    warn: "Requires conversion tracking + image assets (linked on Step 5).",
  },
];

export function StepBook({ accounts, draft, onChange }: Props) {
  function update(patch: Partial<CampaignDraft["book"]>) {
    onChange({ ...draft, book: { ...draft.book, ...patch } });
  }

  return (
    <div className="space-y-6">
      {/* Channel picker — drives every subsequent step */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">
          Channel <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {CHANNEL_OPTIONS.map((opt) => {
            const active = draft.channel === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...draft, channel: opt.value })}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  active
                    ? "border-foreground bg-foreground/[0.04]"
                    : "border-border bg-card hover:bg-muted/40",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                      active
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" />
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
        {draft.channel === "PMAX" && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-700">
            PMAX launch ships on Phase 6 Day 2. You can build the draft now;
            the campaign saves as PAUSED.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="accountId" className="text-sm font-medium">
          Account <span className="text-destructive">*</span>
        </Label>
        <select
          id="accountId"
          name="accountId"
          required
          value={draft.accountId}
          onChange={(e) => onChange({ ...draft, accountId: e.target.value })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {formatCustomerId(a.customerId)}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          The campaign will be created under this Google Ads customer account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="title" className="text-sm font-medium">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={draft.book.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="The Ikigai Companion"
            maxLength={255}
            className="h-10"
          />
        </div>

        <div className="space-y-2 md:col-span-1">
          <Label htmlFor="landingUrl" className="text-sm font-medium">
            Landing page URL <span className="text-destructive">*</span>
          </Label>
          <Input
            id="landingUrl"
            type="url"
            value={draft.book.landingPageUrl}
            onChange={(e) => update({ landingPageUrl: e.target.value })}
            placeholder="https://example.com/ikigai"
            className="h-10"
          />
        </div>

        <div className="space-y-2 md:col-span-1">
          <Label htmlFor="isbn" className="text-sm font-medium">
            ISBN / SKU
          </Label>
          <Input
            id="isbn"
            value={draft.book.isbn ?? ""}
            onChange={(e) => update({ isbn: e.target.value || undefined })}
            placeholder="Optional"
            className="h-10 font-mono"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description" className="text-sm font-medium">
            Description <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="description"
            value={draft.book.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Two-to-three sentence pitch. The ad copy generator uses this in Phase 5; for now it's just metadata for your records."
            rows={5}
            maxLength={2000}
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Plain text. No markdown.</span>
            <span className="font-mono">
              {draft.book.description.length} / 2000
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCustomerId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
