"use client";

/**
 * Autopilot Create Campaign — single-page widget-bar UX.
 *
 * Now covers Phases A1 → A9 (everything except A6 conv-tracking gate,
 * A7 bidding strategy chooser, A10 refinement chat):
 *
 *   ✓ Widget bar (brand + brief + URL + channel)
 *   ✓ AUTO bucket — copy fields, inline editable, edited-flag tracking
 *   ✓ Image generation (Fast/Refined modes, master + logo previews)
 *   ✓ INFERRED bucket — country dropdown (defaults from architect)
 *   ✓ MANUAL bucket — account picker + daily budget
 *   ✓ Review summary
 *   ✓ Launch button — translates draft → wizard payload → Campaign row
 *     created as PAUSED, redirect to detail page where LaunchCard
 *     pushes to Google
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Globe,
  ImageIcon,
  Layers,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Wand2,
  Zap,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  GeneratedPmaxCopy,
  GeneratedSearchCopy,
} from "@/lib/ai/types";
import type { GeneratedAssetIds, PipelineMode } from "@/lib/ai/pipeline";
import {
  SUPPORTED_COUNTRIES,
  type CountryCode,
} from "@/lib/wizard/schema";

import {
  generateImagesAction,
  launchCampaignFromCreate,
  planAndGenerateCopy,
  regenerateCopy,
  type BiddingStrategyInput,
  type ConversionTrackingInput,
  type CreateBrief,
  type LaunchableAccount,
  type PlanAndGenerateResult,
} from "./actions";

// ---------------------------------------------------------------------------
// A6: Conversion tracking shape — UI choices.
// ---------------------------------------------------------------------------
type TrackingMode = ConversionTrackingInput["mode"];
type EventKey =
  | "form_submit"
  | "page_view_thanks"
  | "phone_call_30s"
  | "add_to_cart"
  | "purchase"
  | "whatsapp_click";
const EVENT_LABELS: Record<EventKey, string> = {
  form_submit: "Form submission",
  page_view_thanks: "Page view on /thanks",
  phone_call_30s: "Phone call > 30s",
  add_to_cart: "Add to cart",
  purchase: "Purchase completed",
  whatsapp_click: "WhatsApp click",
};

// ---------------------------------------------------------------------------
// A7: Bidding strategy — channel-aware option lists. Some options are
// gated on conversion tracking being validated.
// ---------------------------------------------------------------------------
type BiddingStrategyId = BiddingStrategyInput["strategy"];
type BiddingOption = {
  id: BiddingStrategyId;
  label: string;
  requiresTracking: boolean;
  requiresValue?: "cpa" | "roas";
};
const SEARCH_BIDDING_OPTIONS: BiddingOption[] = [
  { id: "MAXIMIZE_CLICKS", label: "Maximize Clicks", requiresTracking: false },
  {
    id: "MAXIMIZE_CONVERSIONS",
    label: "Maximize Conversions",
    requiresTracking: true,
  },
  {
    id: "TARGET_CPA",
    label: "Target CPA",
    requiresTracking: true,
    requiresValue: "cpa",
  },
];
const PMAX_BIDDING_OPTIONS: BiddingOption[] = [
  {
    id: "MAXIMIZE_CONVERSIONS",
    label: "Maximize Conversions",
    requiresTracking: true,
  },
  {
    id: "MAXIMIZE_CONVERSION_VALUE",
    label: "Maximize Conversion Value",
    requiresTracking: true,
  },
  {
    id: "TARGET_CPA",
    label: "Target CPA",
    requiresTracking: true,
    requiresValue: "cpa",
  },
  {
    id: "TARGET_ROAS",
    label: "Target ROAS",
    requiresTracking: true,
    requiresValue: "roas",
  },
];

type Channel = "SEARCH" | "PMAX";

type EditableList = Array<{ text: string; edited: boolean }>;
type EditableField = { text: string; edited: boolean };

type DraftCopy = {
  channel: Channel;
  brandName: EditableField;
  businessName: EditableField;
  headlines: EditableList;
  longHeadlines: EditableList;
  descriptions: EditableList;
  keywords: EditableList;
};

export function CreateForm({ accounts }: { accounts: LaunchableAccount[] }) {
  const router = useRouter();

  // -------- Widget brief inputs ------------------------------------------
  const [brandName, setBrandName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [channel, setChannel] = useState<Channel>("SEARCH");

  // -------- Generation state --------------------------------------------
  const [pending, startTransition] = useTransition();
  const [regenPending, startRegen] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<
    (PlanAndGenerateResult & { ok: true })["plan"] | null
  >(null);
  const [draft, setDraft] = useState<DraftCopy | null>(null);

  // -------- Image state -------------------------------------------------
  const [imagePending, startImageGen] = useTransition();
  const [imageMode, setImageMode] = useState<PipelineMode>("fast");
  const [imageIds, setImageIds] = useState<GeneratedAssetIds | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // -------- Bucket 2 (INFERRED) -----------------------------------------
  const [country, setCountry] = useState<CountryCode>("US");

  // -------- Bucket 3 (MANUAL) -------------------------------------------
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState<number>(10);

  // -------- A6 Conversion tracking --------------------------------------
  const [trackingMode, setTrackingMode] = useState<TrackingMode | null>(null);
  const [trackingEvents, setTrackingEvents] = useState<Set<EventKey>>(
    new Set(["form_submit"]),
  );
  const [trackingValueType, setTrackingValueType] = useState<
    ConversionTrackingInput["valueType"]
  >("count-only");
  const [trackingValueAmount, setTrackingValueAmount] = useState<number>(0);
  const [trackingValidated, setTrackingValidated] = useState(false);

  // -------- A7 Bidding strategy ----------------------------------------
  const [biddingStrategyId, setBiddingStrategyId] =
    useState<BiddingStrategyId>("MAXIMIZE_CLICKS");
  const [targetCpaUsd, setTargetCpaUsd] = useState<number>(20);
  const [targetRoas, setTargetRoas] = useState<number>(3);

  // -------- A10 Refinement chat -----------------------------------------
  const [refinement, setRefinement] = useState("");
  const [refining, startRefine] = useTransition();

  // -------- Launch ------------------------------------------------------
  const [launching, startLaunch] = useTransition();
  const [launchError, setLaunchError] = useState<string | null>(null);

  // A7: filter bidding options by channel; lock conversion-based ones
  // when tracking isn't declared-validated.
  const biddingOptions = useMemo(() => {
    const base = channel === "PMAX" ? PMAX_BIDDING_OPTIONS : SEARCH_BIDDING_OPTIONS;
    return base.map((opt) => ({
      ...opt,
      enabled: opt.requiresTracking ? trackingValidated : true,
    }));
  }, [channel, trackingValidated]);

  // Auto-revert to the safest enabled bidding option if the user's
  // current pick becomes locked (e.g. they toggled off the validated
  // checkbox after picking Target CPA).
  const currentBidding = biddingOptions.find((o) => o.id === biddingStrategyId);
  if (currentBidding && !currentBidding.enabled) {
    const fallback = biddingOptions.find((o) => o.enabled);
    if (fallback) {
      // Schedule via timeout to avoid React state-during-render warning.
      queueMicrotask(() => setBiddingStrategyId(fallback.id));
    }
  }

  const canGenerate =
    brandName.trim().length > 0 &&
    productDescription.trim().length >= 10 &&
    !pending;

  const canLaunch =
    !!draft &&
    !!accountId &&
    dailyBudgetUsd >= 1 &&
    !launching;

  function briefPayload(): CreateBrief {
    return {
      brandName,
      productDescription,
      landingPageUrl: landingPageUrl || undefined,
      channel,
    };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canGenerate) return;
    setError(null);
    startTransition(async () => {
      const res = await planAndGenerateCopy(briefPayload());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
      setDraft(buildDraftFromCopy(res.copy, brandName));
    });
  }

  function onRegenerate() {
    if (!draft) return;
    setError(null);
    startRegen(async () => {
      const res = await regenerateCopy(briefPayload());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft((prev) =>
        prev ? mergePreservingEdits(prev, res.copy) : null,
      );
    });
  }

  function onGenerateImages() {
    setImageError(null);
    startImageGen(async () => {
      const res = await generateImagesAction(
        briefPayload(),
        imageMode,
        accountId || undefined,
      );
      if (!res.ok) {
        setImageError(res.error);
        return;
      }
      setImageIds(res.ids);
    });
  }

  function onRefine() {
    if (!draft) return;
    const refinementText = refinement.trim();
    if (!refinementText) return;
    setError(null);
    startRefine(async () => {
      const res = await planAndGenerateCopy({
        brandName,
        productDescription: `${productDescription}\n\nRefinement: ${refinementText}`,
        landingPageUrl: landingPageUrl || undefined,
        channel,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
      setDraft((prev) =>
        prev
          ? mergePreservingEdits(prev, res.copy)
          : buildDraftFromCopy(res.copy, brandName),
      );
      setRefinement("");
    });
  }

  function onLaunch() {
    if (!draft || !canLaunch) return;
    setLaunchError(null);
    startLaunch(async () => {
      const res = await launchCampaignFromCreate({
        brief: briefPayload(),
        channel,
        accountId,
        dailyBudgetUsd,
        audience: { country },
        ...(channel === "SEARCH"
          ? {
              search: {
                headlines: draft.headlines
                  .map((h) => h.text.trim())
                  .filter(Boolean),
                descriptions: draft.descriptions
                  .map((d) => d.text.trim())
                  .filter(Boolean),
                keywords: draft.keywords
                  .map((k) => k.text.trim())
                  .filter(Boolean),
              },
            }
          : {
              pmax: {
                headlines: draft.headlines
                  .map((h) => h.text.trim())
                  .filter(Boolean),
                longHeadlines: draft.longHeadlines
                  .map((h) => h.text.trim())
                  .filter(Boolean),
                descriptions: draft.descriptions
                  .map((d) => d.text.trim())
                  .filter(Boolean),
                businessName: draft.businessName.text.trim(),
              },
              assetIds: imageIds ?? undefined,
            }),
        // A6: forward the user's conversion-tracking setup choices.
        // Audit-logged; Phase 8c will wire the actual integrations.
        conversionTracking: trackingMode
          ? {
              mode: trackingMode,
              events: Array.from(trackingEvents),
              valueType: trackingValueType,
              valueAmount:
                trackingValueType === "fixed" ? trackingValueAmount : undefined,
              declaredValidated: trackingValidated,
            }
          : undefined,
        // A7: bidding strategy override (UI ensures this is valid per
        // the tracking-validation gate).
        bidding: {
          strategy: biddingStrategyId,
          targetCpaUsd:
            biddingStrategyId === "TARGET_CPA" ? targetCpaUsd : undefined,
          targetRoas:
            biddingStrategyId === "TARGET_ROAS" ? targetRoas : undefined,
        },
      });
      if (!res.ok) {
        setLaunchError(res.error);
        return;
      }
      router.push(`/app/campaigns/${res.campaignId}`);
    });
  }

  // A6: toggle an event in the tracking events set
  function toggleEvent(key: EventKey) {
    setTrackingEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="container-page py-10 md:py-14">
      {/* Header */}
      <header className="max-w-2xl">
        <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
          <Sparkles className="size-3" />
          Autopilot
        </div>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Create a campaign
        </h1>
        <p className="mt-3 text-pretty text-[14px] leading-7 text-muted-foreground">
          Tell us about your business. We&apos;ll pick the style, write
          copy, generate images, and pre-fill everything else — you
          review and launch.
        </p>
      </header>

      {/* Widget bar */}
      <form
        onSubmit={onSubmit}
        className="mt-8 grid max-w-2xl gap-5 rounded-2xl border border-border bg-card p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <Label className="text-[13px] font-medium">
            Brand name <span className="text-destructive">*</span>
          </Label>
          <ChannelToggle
            value={channel}
            onChange={setChannel}
            disabled={pending}
          />
        </div>
        <Input
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          placeholder="e.g. Ballast Books"
          maxLength={50}
          disabled={pending}
          className="h-10"
        />

        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">
            What are you advertising?{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
            placeholder="e.g. Independent publisher of self-help books. Target busy professionals 30-50."
            rows={5}
            maxLength={1500}
            disabled={pending}
          />
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {productDescription.length} / 1500
          </span>
        </div>

        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">
            Landing page URL{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            type="url"
            value={landingPageUrl}
            onChange={(e) => setLandingPageUrl(e.target.value)}
            placeholder="https://yourbrand.com/shop"
            disabled={pending}
            className="h-10"
          />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canGenerate}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-foreground px-5 text-[13.5px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="size-4" />
          {pending
            ? "Generating…"
            : draft
              ? "Re-plan (replaces all unedited fields)"
              : "Generate campaign"}
        </button>
        {pending && (
          <p className="text-center text-[11.5px] text-muted-foreground">
            Picking style pack + writing copy. ~5 seconds.
          </p>
        )}
      </form>

      {/* AUTO bucket — appears after first successful generate */}
      {draft && plan && (
        <section className="mt-10 grid max-w-3xl gap-6">
          {/* Plan badge + regenerate */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-gradient-to-br from-violet-500/[0.04] to-transparent p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-background">
                <Sparkles className="size-4" />
              </div>
              <div>
                <div className="text-[13.5px] font-semibold">
                  AI picked {plan.sector}
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Style pack: {plan.packLabel} ·{" "}
                  <span className="font-mono">{plan.packMode}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenPending || pending}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              title="Re-roll copy. Manually-edited fields are preserved."
            >
              <RefreshCw
                className={cn("size-3.5", regenPending && "animate-spin")}
              />
              {regenPending ? "Refreshing…" : "Regenerate copy"}
            </button>
          </div>

          {/* A10 — Refinement chat */}
          <RefinementChat
            value={refinement}
            onChange={setRefinement}
            onSubmit={onRefine}
            pending={refining}
          />

          {/* A5 — Visual ad-group scaffold (single ad group for now) */}
          <AdGroupScaffold channel={draft.channel} />

          {/* Copy fields */}
          {draft.channel === "PMAX" && (
            <SingleField
              label="Business name"
              required
              maxLen={25}
              field={draft.businessName}
              onChange={(text) =>
                setDraft((d) =>
                  d ? { ...d, businessName: { text, edited: true } } : d,
                )
              }
            />
          )}

          <ListField
            label={draft.channel === "PMAX" ? "Short headlines" : "Headlines"}
            required
            maxItems={15}
            maxLen={30}
            items={draft.headlines}
            onChange={(items) =>
              setDraft((d) => (d ? { ...d, headlines: items } : d))
            }
          />

          {draft.channel === "PMAX" && (
            <ListField
              label="Long headlines"
              required
              maxItems={5}
              maxLen={90}
              multiline
              items={draft.longHeadlines}
              onChange={(items) =>
                setDraft((d) => (d ? { ...d, longHeadlines: items } : d))
              }
            />
          )}

          <ListField
            label="Descriptions"
            required
            maxItems={draft.channel === "PMAX" ? 5 : 4}
            maxLen={90}
            multiline
            items={draft.descriptions}
            onChange={(items) =>
              setDraft((d) => (d ? { ...d, descriptions: items } : d))
            }
          />

          {draft.channel === "SEARCH" && (
            <ListField
              label="Keyword suggestions"
              required
              maxItems={500}
              maxLen={80}
              items={draft.keywords}
              onChange={(items) =>
                setDraft((d) => (d ? { ...d, keywords: items } : d))
              }
            />
          )}

          {/* Images panel — optional but recommended for PMAX */}
          <ImagesPanel
            channel={draft.channel}
            mode={imageMode}
            onModeChange={setImageMode}
            ids={imageIds}
            pending={imagePending}
            error={imageError}
            onGenerate={onGenerateImages}
          />

          {/* Bucket 2 — INFERRED */}
          <Bucket2
            country={country}
            onCountryChange={setCountry}
            disabled={launching}
          />

          {/* Bucket 3 — MANUAL */}
          <Bucket3
            accounts={accounts}
            accountId={accountId}
            onAccountIdChange={setAccountId}
            dailyBudgetUsd={dailyBudgetUsd}
            onBudgetChange={setDailyBudgetUsd}
            disabled={launching}
          />

          {/* A6 — Conversion tracking (hard gate for conversion-based bidding) */}
          <ConversionTrackingSection
            mode={trackingMode}
            onModeChange={setTrackingMode}
            events={trackingEvents}
            onToggleEvent={toggleEvent}
            valueType={trackingValueType}
            onValueTypeChange={setTrackingValueType}
            valueAmount={trackingValueAmount}
            onValueAmountChange={setTrackingValueAmount}
            validated={trackingValidated}
            onValidatedChange={setTrackingValidated}
            disabled={launching}
          />

          {/* A7 — Bidding strategy (gated on A6 validated) */}
          <BiddingStrategySection
            channel={channel}
            options={biddingOptions}
            value={biddingStrategyId}
            onChange={setBiddingStrategyId}
            targetCpaUsd={targetCpaUsd}
            onTargetCpaChange={setTargetCpaUsd}
            targetRoas={targetRoas}
            onTargetRoasChange={setTargetRoas}
            trackingValidated={trackingValidated}
            disabled={launching}
          />

          {/* Review + Launch */}
          <ReviewAndLaunch
            channel={channel}
            brandName={brandName}
            accountLabel={
              accounts.find((a) => a.id === accountId)?.descriptiveName ?? "—"
            }
            country={country}
            dailyBudgetUsd={dailyBudgetUsd}
            hasImages={!!imageIds}
            canLaunch={canLaunch}
            launching={launching}
            launchError={launchError}
            onLaunch={onLaunch}
          />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel toggle
// ---------------------------------------------------------------------------

function ChannelToggle({
  value,
  onChange,
  disabled,
}: {
  value: Channel;
  onChange: (c: Channel) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Campaign channel"
      className={cn(
        "inline-flex rounded-md border border-border bg-background p-0.5",
        disabled && "opacity-50",
      )}
    >
      {(["SEARCH", "PMAX"] as Channel[]).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            value === c
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {c === "SEARCH" ? (
            <Zap className="size-3" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {c}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable field components
// ---------------------------------------------------------------------------

function SingleField({
  label,
  required,
  maxLen,
  field,
  onChange,
}: {
  label: string;
  required?: boolean;
  maxLen: number;
  field: EditableField;
  onChange: (text: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          {label} {required && <span className="text-destructive">*</span>}
          {field.edited && <EditedDot />}
        </Label>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {field.text.length} / {maxLen}
        </span>
      </div>
      <Input
        value={field.text}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLen}
        className="mt-3 h-10"
      />
    </div>
  );
}

function ListField({
  label,
  required,
  maxItems,
  maxLen,
  multiline,
  items,
  onChange,
}: {
  label: string;
  required?: boolean;
  maxItems: number;
  maxLen: number;
  multiline?: boolean;
  items: EditableList;
  onChange: (next: EditableList) => void;
}) {
  function update(i: number, text: string) {
    onChange(
      items.map((it, idx) => (idx === i ? { text, edited: true } : it)),
    );
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  const editedCount = items.filter((it) => it.edited).length;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          {label} {required && <span className="text-destructive">*</span>}
          {editedCount > 0 && (
            <span
              className="ml-1.5 font-mono text-[10px] text-muted-foreground"
              title="Fields you've manually edited — won't be overwritten on regenerate"
            >
              {editedCount} edited
            </span>
          )}
        </Label>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {items.length} / {maxItems}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((it, i) => {
          const InputEl = multiline ? Textarea : Input;
          return (
            <li key={i} className="flex items-start gap-2">
              <InputEl
                value={it.text}
                onChange={(e) => update(i, e.currentTarget.value)}
                maxLength={maxLen}
                rows={multiline ? 2 : undefined}
                className={multiline ? undefined : "h-9 text-[13px]"}
              />
              <div className="flex w-12 shrink-0 items-center justify-between">
                {it.edited && <EditedDot />}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
                  className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                >
                  <span aria-hidden>×</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditedDot() {
  return (
    <span
      className="ml-1 inline-block size-1.5 rounded-full bg-violet-500"
      title="You've edited this field — regenerate won't overwrite it"
    />
  );
}

// ---------------------------------------------------------------------------
// Images panel — A2
// ---------------------------------------------------------------------------

function ImagesPanel({
  channel,
  mode,
  onModeChange,
  ids,
  pending,
  error,
  onGenerate,
}: {
  channel: Channel;
  mode: PipelineMode;
  onModeChange: (m: PipelineMode) => void;
  ids: GeneratedAssetIds | null;
  pending: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const masterUrl = ids?.marketingImageAssetId
    ? `/api/assets/${ids.marketingImageAssetId}/bytes`
    : null;
  const logoUrl = ids?.logoAssetId
    ? `/api/assets/${ids.logoAssetId}/bytes`
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground">
            <ImageIcon className="size-4" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold">
              Images
              {channel === "SEARCH" && (
                <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">
                  optional
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {channel === "PMAX"
                ? "PMAX requires a master image + logo. We generate both."
                : "SEARCH doesn't require images, but generating them now means you can re-use them later."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModePill mode={mode} onChange={onModeChange} disabled={pending} />
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-[12.5px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="size-3.5" />
            {pending
              ? "Generating…"
              : ids
                ? "Regenerate images"
                : "Generate images"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </p>
      )}

      {ids && (masterUrl || logoUrl) && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <ImageTile label="Master (sharp-cropped to 5 sizes)" src={masterUrl} aspect="1/1" />
          <ImageTile label="Logo (sharp-cropped to 2 sizes)" src={logoUrl} aspect="1/1" />
        </div>
      )}
    </div>
  );
}

function ModePill({
  mode,
  onChange,
  disabled,
}: {
  mode: PipelineMode;
  onChange: (m: PipelineMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Image pipeline mode"
      className={cn(
        "inline-flex rounded-md border border-border bg-background p-0.5",
        disabled && "opacity-50",
      )}
    >
      {(["fast", "refined"] as PipelineMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          disabled={disabled}
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
            mode === m
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {m === "fast" ? "Fast" : "Refined"}
        </button>
      ))}
    </div>
  );
}

function ImageTile({
  label,
  src,
  aspect,
}: {
  label: string;
  src: string | null;
  aspect: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div
        className="bg-muted"
        style={{ aspectRatio: aspect }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="size-full object-contain" />
        ) : (
          <div className="grid size-full place-items-center font-mono text-[10px] text-muted-foreground">
            (pending)
          </div>
        )}
      </div>
      <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bucket 2 — INFERRED (country only for v1)
// ---------------------------------------------------------------------------

function Bucket2({
  country,
  onCountryChange,
  disabled,
}: {
  country: CountryCode;
  onCountryChange: (c: CountryCode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          Audience{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            inferred
          </span>
        </Label>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Country defaults to US. Pick another from the list — autopilot
        targets nationwide for now.
      </p>
      <select
        value={country}
        onChange={(e) => onCountryChange(e.target.value as CountryCode)}
        disabled={disabled}
        className="mt-3 h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
      >
        {SUPPORTED_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bucket 3 — MANUAL (account + budget)
// ---------------------------------------------------------------------------

function Bucket3({
  accounts,
  accountId,
  onAccountIdChange,
  dailyBudgetUsd,
  onBudgetChange,
  disabled,
}: {
  accounts: LaunchableAccount[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
  dailyBudgetUsd: number;
  onBudgetChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          Account &amp; budget{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            you decide
          </span>
        </Label>
      </div>

      {accounts.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border bg-background p-4 text-center">
          <p className="text-[12.5px] text-muted-foreground">
            No live Google Ads accounts connected yet.
          </p>
          <Link
            href="/app/accounts/new"
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-foreground hover:underline"
          >
            <Plus className="size-3.5" />
            Connect one
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2">
            <Label className="text-[12px] font-medium">Google Ads account</Label>
            <select
              value={accountId}
              onChange={(e) => onAccountIdChange(e.target.value)}
              disabled={disabled}
              className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.descriptiveName} · {formatCustomerId(a.customerId)}
                  {a.isLegacy ? " · (env creds)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 grid gap-2">
            <Label className="text-[12px] font-medium">
              Daily budget (USD)
            </Label>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[13px] text-muted-foreground">
                $
              </span>
              <Input
                type="number"
                min={1}
                step={1}
                value={dailyBudgetUsd}
                onChange={(e) =>
                  onBudgetChange(Number(e.target.value) || 1)
                }
                disabled={disabled}
                className="h-10 max-w-[120px]"
              />
              <input
                type="range"
                min={1}
                max={500}
                value={dailyBudgetUsd}
                onChange={(e) => onBudgetChange(Number(e.target.value))}
                disabled={disabled}
                className="flex-1 accent-foreground"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Google bills your account directly. Min $1/day.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review + Launch
// ---------------------------------------------------------------------------

function ReviewAndLaunch({
  channel,
  brandName,
  accountLabel,
  country,
  dailyBudgetUsd,
  hasImages,
  canLaunch,
  launching,
  launchError,
  onLaunch,
}: {
  channel: Channel;
  brandName: string;
  accountLabel: string;
  country: CountryCode;
  dailyBudgetUsd: number;
  hasImages: boolean;
  canLaunch: boolean;
  launching: boolean;
  launchError: string | null;
  onLaunch: () => void;
}) {
  const needsImagesForPmax = channel === "PMAX" && !hasImages;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          Review &amp; launch{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            final step
          </span>
        </Label>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
        <ReviewRow label="Brand" value={brandName} />
        <ReviewRow label="Channel" value={channel} />
        <ReviewRow label="Country" value={country} />
        <ReviewRow label="Daily budget" value={`$${dailyBudgetUsd}`} />
        <ReviewRow label="Account" value={accountLabel} />
        <ReviewRow
          label="Images"
          value={hasImages ? "Generated" : "Not generated"}
          warn={needsImagesForPmax}
        />
      </dl>

      {needsImagesForPmax && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-800">
          PMAX needs at least a master image + logo. Generate them above
          before launching, or switch to SEARCH.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted-foreground">
          Campaign will be created as <strong>Paused</strong>. Push it
          live from the campaign detail page.
        </p>
        <button
          type="button"
          onClick={onLaunch}
          disabled={!canLaunch || needsImagesForPmax}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {launching ? (
            <CheckCircle2 className="size-4 animate-pulse" />
          ) : (
            <Rocket className="size-4" />
          )}
          {launching ? "Creating…" : "Create campaign"}
        </button>
      </div>

      {launchError && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {launchError}
        </p>
      )}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "truncate text-[12.5px] font-medium",
          warn ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function formatCustomerId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ---------------------------------------------------------------------------
// A10 — Refinement chat
//
// Multi-turn refinement. Each turn appends the user's note to the brief
// and re-runs architect + copy. Edited fields are preserved via the
// merge helper.
// ---------------------------------------------------------------------------

function RefinementChat({
  value,
  onChange,
  onSubmit,
  pending,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground">
          <MessageCircle className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Refine the copy</div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Type a follow-up (&quot;more urgent&quot;, &quot;mention free shipping&quot;) and we&apos;ll
            re-roll. Your manual edits stay.
          </p>
          <div className="mt-3 flex gap-2">
            <Textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="e.g. Sound more conversational. Mention 30-day money-back guarantee."
              rows={2}
              disabled={pending}
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending || !value.trim()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 self-end rounded-md bg-foreground px-3.5 text-[12.5px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className={cn("size-3.5", pending && "animate-pulse")} />
              {pending ? "Refining…" : "Refine"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A5 — Visual ad-group scaffold
//
// For v1 every autopilot campaign launches with a single ad group. The
// schema (AdGroup table) is already plural-ready, but the launcher
// adapters still create one ad group per campaign. This card hints at
// the planned shape without changing behavior.
// ---------------------------------------------------------------------------

function AdGroupScaffold({ channel }: { channel: Channel }) {
  const label = channel === "PMAX" ? "asset group" : "ad group";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <Layers className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium">
          {label.charAt(0).toUpperCase() + label.slice(1)} 1 of 1
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          default theme
        </span>
      </div>
      <button
        type="button"
        disabled
        title={`Multi-${label} support arrives with the launcher v2 refactor (Phase A5).`}
        className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground opacity-60"
      >
        <Plus className="size-3" />
        Add {label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A6 — Conversion tracking
//
// Four modes (hosted / existing / CRM / phone). For v1 the real tag /
// GTM / CRM / phone-tracking integrations aren't wired yet — see Phase
// 8c / 9 in AUTOPILOT_VISION_DRAFT.md. We collect the choices, the user
// attests "tracking is set up", and that unlocks conversion-based
// bidding strategies in A7.
// ---------------------------------------------------------------------------

const TRACKING_MODES: Array<{
  id: TrackingMode;
  label: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
}> = [
  {
    id: "hosted",
    label: "Hosted landing page",
    helper: "Adsense hosts a page at <brand>.adsense.app with tracking pre-wired.",
    icon: Globe,
    comingSoon: true,
  },
  {
    id: "existing-site",
    label: "Your existing website",
    helper: "Paste the gtag snippet OR connect Google Tag Manager.",
    icon: ShieldCheck,
  },
  {
    id: "crm",
    label: "CRM (HubSpot / Pipedrive / Zoho)",
    helper:
      "Connect via OAuth — qualified leads flow back to Google for bid optimization.",
    icon: Users,
    comingSoon: true,
  },
  {
    id: "phone",
    label: "Phone / WhatsApp",
    helper: "Google call-tracking number forwarded to yours.",
    icon: Phone,
    comingSoon: true,
  },
];

function ConversionTrackingSection({
  mode,
  onModeChange,
  events,
  onToggleEvent,
  valueType,
  onValueTypeChange,
  valueAmount,
  onValueAmountChange,
  validated,
  onValidatedChange,
  disabled,
}: {
  mode: TrackingMode | null;
  onModeChange: (m: TrackingMode) => void;
  events: Set<EventKey>;
  onToggleEvent: (k: EventKey) => void;
  valueType: ConversionTrackingInput["valueType"];
  onValueTypeChange: (t: ConversionTrackingInput["valueType"]) => void;
  valueAmount: number;
  onValueAmountChange: (n: number) => void;
  validated: boolean;
  onValidatedChange: (b: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          Conversion tracking{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            hard gate
          </span>
        </Label>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Set this up so the optimizer can tell which clicks turned into
        leads. Required to unlock Max Conversions / Target CPA bidding.
      </p>

      {/* Mode pick */}
      <div className="mt-4 grid gap-2">
        <Label className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
          Where do conversions happen?
        </Label>
        <div className="grid gap-2">
          {TRACKING_MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onModeChange(m.id)}
                disabled={disabled || m.comingSoon}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                  isActive
                    ? "border-foreground bg-foreground/[0.04]"
                    : "border-border bg-background hover:bg-muted",
                  m.comingSoon && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded",
                    isActive ? "bg-foreground text-background" : "bg-muted",
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                    {m.label}
                    {m.comingSoon && (
                      <span className="rounded border border-border bg-muted px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        soon
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {m.helper}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* What counts */}
      {mode && (
        <>
          <div className="mt-5 grid gap-2">
            <Label className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
              What counts as a conversion?
            </Label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {(Object.keys(EVENT_LABELS) as EventKey[]).map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={events.has(key)}
                    onChange={() => onToggleEvent(key)}
                    disabled={disabled}
                    className="size-3.5 accent-foreground"
                  />
                  {EVENT_LABELS[key]}
                </label>
              ))}
            </div>
          </div>

          {/* Conversion value */}
          <div className="mt-5 grid gap-2">
            <Label className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
              Conversion value
            </Label>
            <div className="flex flex-wrap items-center gap-3">
              {(
                [
                  { v: "fixed", label: "Same per conversion" },
                  { v: "variable", label: "Variable (dynamic)" },
                  { v: "count-only", label: "Count only" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.v}
                  className="flex cursor-pointer items-center gap-2 text-[12px]"
                >
                  <input
                    type="radio"
                    checked={valueType === opt.v}
                    onChange={() => onValueTypeChange(opt.v)}
                    disabled={disabled}
                    className="accent-foreground"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {valueType === "fixed" && (
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-[13px] text-muted-foreground">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={valueAmount}
                  onChange={(e) =>
                    onValueAmountChange(Number(e.target.value) || 0)
                  }
                  disabled={disabled}
                  className="h-9 max-w-[120px]"
                />
              </div>
            )}
          </div>

          {/* Attestation gate */}
          <label className="mt-5 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-[12px]">
            <input
              type="checkbox"
              checked={validated}
              onChange={(e) => onValidatedChange(e.target.checked)}
              disabled={disabled}
              className="mt-0.5 size-3.5 accent-foreground"
            />
            <span>
              <strong>I confirm tracking is set up</strong> on my landing
              page or website. Unlocks Max Conversions and Target CPA
              bidding. (Real validate-test-event button arrives in Phase
              8c — for now this is your attestation.)
            </span>
          </label>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A7 — Bidding strategy
//
// Channel-aware option list, with conversion-based options locked
// behind A6's `declaredValidated` checkbox.
// ---------------------------------------------------------------------------

function BiddingStrategySection({
  channel,
  options,
  value,
  onChange,
  targetCpaUsd,
  onTargetCpaChange,
  targetRoas,
  onTargetRoasChange,
  trackingValidated,
  disabled,
}: {
  channel: Channel;
  options: Array<BiddingOption & { enabled: boolean }>;
  value: BiddingStrategyId;
  onChange: (id: BiddingStrategyId) => void;
  targetCpaUsd: number;
  onTargetCpaChange: (n: number) => void;
  targetRoas: number;
  onTargetRoasChange: (n: number) => void;
  trackingValidated: boolean;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          Bidding strategy{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            depends on tracking
          </span>
        </Label>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {trackingValidated
          ? "Tracking confirmed — all strategies available."
          : "Conversion-based strategies are locked. Confirm tracking above to unlock."}
      </p>

      {channel === "PMAX" && !trackingValidated && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-800">
          <Target className="mr-1 inline size-3" />
          PMAX requires conversion tracking. Set it up above before
          launching.
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            disabled={disabled || !opt.enabled}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              value === opt.id && opt.enabled
                ? "border-foreground bg-foreground/[0.04] font-medium"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <span>{opt.label}</span>
            {opt.requiresTracking && !opt.enabled && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                needs tracking
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Target CPA input */}
      {current?.requiresValue === "cpa" && current.enabled && (
        <div className="mt-4 flex items-center gap-2">
          <Label className="text-[12px]">Target CPA</Label>
          <span className="font-mono text-[12px] text-muted-foreground">
            $
          </span>
          <Input
            type="number"
            min={1}
            step={1}
            value={targetCpaUsd}
            onChange={(e) =>
              onTargetCpaChange(Number(e.target.value) || 1)
            }
            disabled={disabled}
            className="h-9 max-w-[120px]"
          />
        </div>
      )}

      {/* Target ROAS input */}
      {current?.requiresValue === "roas" && current.enabled && (
        <div className="mt-4 flex items-center gap-2">
          <Label className="text-[12px]">Target ROAS</Label>
          <Input
            type="number"
            min={0.1}
            step={0.1}
            value={targetRoas}
            onChange={(e) =>
              onTargetRoasChange(Number(e.target.value) || 0.1)
            }
            disabled={disabled}
            className="h-9 max-w-[120px]"
          />
          <span className="text-[11px] text-muted-foreground">
            e.g. 3.5 = $3.50 revenue per $1 ad spend
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server-copy → draft helpers
// ---------------------------------------------------------------------------

type ServerCopy =
  | { channel: "SEARCH"; copy: GeneratedSearchCopy }
  | { channel: "PMAX"; copy: GeneratedPmaxCopy };

function buildDraftFromCopy(c: ServerCopy, brandName: string): DraftCopy {
  if (c.channel === "PMAX") {
    return {
      channel: "PMAX",
      brandName: { text: brandName, edited: false },
      businessName: {
        text: c.copy.businessName || brandName.slice(0, 25),
        edited: false,
      },
      headlines: c.copy.headlines.map((text) => ({ text, edited: false })),
      longHeadlines: c.copy.longHeadlines.map((text) => ({
        text,
        edited: false,
      })),
      descriptions: c.copy.descriptions.map((text) => ({
        text,
        edited: false,
      })),
      keywords: [],
    };
  }
  return {
    channel: "SEARCH",
    brandName: { text: brandName, edited: false },
    businessName: { text: "", edited: false },
    headlines: c.copy.headlines.map((text) => ({ text, edited: false })),
    longHeadlines: [],
    descriptions: c.copy.descriptions.map((text) => ({ text, edited: false })),
    keywords: c.copy.keywords.map((text) => ({ text, edited: false })),
  };
}

function mergePreservingEdits(
  prev: DraftCopy,
  fresh: ServerCopy,
): DraftCopy {
  if (fresh.channel !== prev.channel) {
    return buildDraftFromCopy(fresh, prev.brandName.text);
  }
  if (fresh.channel === "PMAX" && prev.channel === "PMAX") {
    return {
      ...prev,
      businessName: prev.businessName.edited
        ? prev.businessName
        : {
            text:
              fresh.copy.businessName || prev.brandName.text.slice(0, 25),
            edited: false,
          },
      headlines: mergeList(prev.headlines, fresh.copy.headlines),
      longHeadlines: mergeList(prev.longHeadlines, fresh.copy.longHeadlines),
      descriptions: mergeList(prev.descriptions, fresh.copy.descriptions),
    };
  }
  if (fresh.channel === "SEARCH" && prev.channel === "SEARCH") {
    return {
      ...prev,
      headlines: mergeList(prev.headlines, fresh.copy.headlines),
      descriptions: mergeList(prev.descriptions, fresh.copy.descriptions),
      keywords: mergeList(prev.keywords, fresh.copy.keywords),
    };
  }
  return prev;
}

function mergeList(prev: EditableList, freshItems: string[]): EditableList {
  const out: EditableList = [];
  let freshCursor = 0;
  for (let i = 0; i < Math.max(prev.length, freshItems.length); i += 1) {
    const prevItem = prev[i];
    if (prevItem?.edited) {
      out.push(prevItem);
      continue;
    }
    const next = freshItems[freshCursor++];
    if (next != null) out.push({ text: next, edited: false });
  }
  return out;
}
