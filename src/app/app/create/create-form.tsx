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
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FlaskConical,
  HelpCircle,
  ImageIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Rocket,
  Sparkles,
  Star,
  Target,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  PmaxAssetGroupCluster,
  ThemeCluster,
} from "@/lib/ai/types";
import type { GeneratedAssetIds, PipelineMode } from "@/lib/ai/pipeline";
import {
  SUPPORTED_COUNTRIES,
  type CountryCode,
} from "@/lib/wizard/schema";

import {
  DiscoverCardMockup,
  DisplayBannerMockup,
  SearchSerpMockup,
} from "./mockups";

import {
  generateImagesAction,
  generateLogoOnlyAction,
  launchCampaignFromCreate,
  listConversionActionsForAccount,
  loadManualTestAssets,
  planAndGenerateCopy,
  regenerateCopy,
  uploadAssetForRoleAction,
  type BiddingStrategyInput,
  type ConversionActionOption,
  type CreateBrief,
  type LaunchableAccount,
  type PlanAndGenerateResult,
} from "./actions";
import {
  MANUAL_ASSET_FILES,
  MANUAL_DEFAULT_BUDGET_USD,
  MANUAL_LANDING_URL,
  MANUAL_PMAX_CLUSTER,
  MANUAL_PRODUCT_DESCRIPTION,
  manualBrandNameWithSuffix,
} from "./manual-mode";

// ---------------------------------------------------------------------------
// B3 — Conversion tracking on Create-form is now a PICKER over the
// account's existing ConversionAction rows (imported + created from
// our Hub at /app/accounts/[id]/conversion-tracking). The old self-
// attestation form (mode + events + value + checkbox) is removed.
// ConversionTrackingInput is kept imported so the launch payload can
// continue to carry the audit snapshot.
// ---------------------------------------------------------------------------

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

/**
 * One editable SEARCH theme cluster (Phase A5). Each becomes an AdGroup
 * on Google at launch time.
 */
type EditableCluster = {
  themeLabel: string;
  intent: string;
  headlines: EditableList;
  descriptions: EditableList;
  keywords: EditableList;
};

/**
 * One editable PMAX asset-group cluster (Phase A5). Each becomes an
 * AssetGroup on Google at launch time. No keywords (PMAX doesn't use
 * them). Business name is per-cluster — usually identical across, but
 * the user can vary it.
 */
type EditablePmaxCluster = {
  themeLabel: string;
  intent: string;
  businessName: EditableField;
  headlines: EditableList;
  longHeadlines: EditableList;
  descriptions: EditableList;
};

type DraftCopy = {
  channel: Channel;
  brandName: EditableField;
  /** SEARCH only — Phase A5 multi-ad-group cards. */
  clusters: EditableCluster[];
  /** PMAX only — Phase A5 multi-asset-group cards. */
  pmaxClusters: EditablePmaxCluster[];
};

// ---------------------------------------------------------------------------
// Image slots — one card per Google Ads role on the Images panel.
//   • Logo + landscape logo  → upload OR explicit generate (single Gemini call)
//   • Marketing 3 variants   → AI-generated by default, per-slot upload override
// `helperText` is rendered as the inline hint under each card; the client
// validator enforces the same constraints client-side before upload.
// ---------------------------------------------------------------------------
type ImageSlotRole =
  | "square_logo"
  | "landscape_logo"
  | "marketing_image"
  | "square_marketing_image"
  | "portrait_marketing_image";

type ImageSlotSpec = {
  role: ImageSlotRole;
  label: string;
  ratioLabel: string;
  targetRatio: number;
  minWidth: number;
  minHeight: number;
  recommendedSize: string;
  required: boolean;
  /** Logo roles also expose a "Generate" button next to "Upload". */
  isLogo: boolean;
  helperText: string;
};

const IMAGE_SLOTS: ImageSlotSpec[] = [
  {
    role: "square_logo",
    label: "Logo",
    ratioLabel: "1:1",
    targetRatio: 1,
    minWidth: 128,
    minHeight: 128,
    recommendedSize: "1200×1200",
    required: true,
    isLogo: true,
    helperText: "1:1 · min 128×128 · PNG/JPG · max 5MB",
  },
  {
    role: "landscape_logo",
    label: "Landscape logo",
    ratioLabel: "4:1",
    targetRatio: 4,
    minWidth: 512,
    minHeight: 128,
    recommendedSize: "1200×300",
    required: false,
    isLogo: true,
    helperText: "4:1 · min 512×128 · PNG/JPG · max 5MB · optional",
  },
  {
    role: "marketing_image",
    label: "Marketing landscape",
    ratioLabel: "1.91:1",
    targetRatio: 1.91,
    minWidth: 600,
    minHeight: 314,
    recommendedSize: "1200×628",
    required: true,
    isLogo: false,
    helperText: "1.91:1 · min 600×314 · PNG/JPG · max 5MB",
  },
  {
    role: "square_marketing_image",
    label: "Marketing square",
    ratioLabel: "1:1",
    targetRatio: 1,
    minWidth: 300,
    minHeight: 300,
    recommendedSize: "1200×1200",
    required: true,
    isLogo: false,
    helperText: "1:1 · min 300×300 · PNG/JPG · max 5MB",
  },
  {
    role: "portrait_marketing_image",
    label: "Marketing portrait",
    ratioLabel: "4:5",
    targetRatio: 0.8,
    minWidth: 480,
    minHeight: 600,
    recommendedSize: "960×1200",
    required: false,
    isLogo: false,
    helperText: "4:5 · min 480×600 · PNG/JPG · max 5MB · optional",
  },
];

const ASPECT_RATIO_TOLERANCE = 0.05;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = String(e.target?.result ?? "");
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function validateImageFileForSlot(
  file: File,
  slot: ImageSlotSpec,
): Promise<
  | { ok: true; width: number; height: number }
  | { ok: false; error: string }
> {
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    return { ok: false, error: "Only PNG or JPG files are accepted." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File too large — max 5MB, got ${(file.size / 1024 / 1024).toFixed(2)}MB.`,
    };
  }
  const dims = await readImageDimensions(file);
  if (!dims) return { ok: false, error: "Couldn't read image dimensions." };
  if (dims.width < slot.minWidth || dims.height < slot.minHeight) {
    return {
      ok: false,
      error: `Too small — min ${slot.minWidth}×${slot.minHeight}, got ${dims.width}×${dims.height}.`,
    };
  }
  const actual = dims.width / dims.height;
  const drift = Math.abs(actual - slot.targetRatio) / slot.targetRatio;
  if (drift > ASPECT_RATIO_TOLERANCE) {
    return {
      ok: false,
      error: `Wrong aspect — expected ${slot.ratioLabel}, got ${actual.toFixed(2)}:1.`,
    };
  }
  return { ok: true, width: dims.width, height: dims.height };
}

export function CreateForm({ accounts }: { accounts: LaunchableAccount[] }) {
  const router = useRouter();

  // -------- Widget brief inputs ------------------------------------------
  // Landing page URL moved out of the widget bar — it's a "you decide"
  // field (lives in Bucket 3 below) rather than something the architect
  // needs to start working. Copy + images can generate without it.
  const [brandName, setBrandName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [channel, setChannel] = useState<Channel>("SEARCH");

  // -------- Manual mode (test-only) -------------------------------------
  // Bypasses Gemini entirely so we can verify the Google Ads launch
  // pipeline end-to-end (PMax especially) without burning AI quota.
  // When ON: brand/description/URL get pre-filled with mock bookstore
  // copy, the channel locks to PMAX, AI generation buttons are hidden,
  // and the launch flow ingests hand-cropped images from
  // public/manual-test-assets/ (see README.md in that folder).
  const [manualMode, setManualMode] = useState(false);

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

  // -------- B3 Conversion tracking (real picker over imported + created
  //          actions). Replaces A6's self-attestation gate. ---------------
  const [conversionActions, setConversionActions] = useState<
    ConversionActionOption[]
  >([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [primaryActionId, setPrimaryActionId] = useState<string | null>(null);

  // Re-fetch the chosen account's conversion actions whenever the user
  // switches accounts. Empty list when accountId is unset. All
  // setState calls live inside an async chain to satisfy React 19's
  // set-state-in-effect lint (no sync setState inside the effect body).
  useEffect(() => {
    let cancelled = false;
    const fetcher = accountId
      ? listConversionActionsForAccount(accountId)
      : Promise.resolve([] as ConversionActionOption[]);
    Promise.resolve().then(() => {
      if (cancelled) return;
      setTrackingLoading(!!accountId);
    });
    fetcher
      .then((rows) => {
        if (cancelled) return;
        setConversionActions(rows);
        // Auto-pick: prefer the working primary, else the first working
        // action, else any enabled, else null (forces MAX_CLICKS).
        const workingPrimary = rows.find(
          (r) => r.isPrimary && r.health === "working" && r.status === "ENABLED",
        );
        const anyWorking = rows.find(
          (r) => r.health === "working" && r.status === "ENABLED",
        );
        const anyEnabled = rows.find((r) => r.status === "ENABLED");
        setPrimaryActionId(
          workingPrimary?.id ?? anyWorking?.id ?? anyEnabled?.id ?? null,
        );
      })
      .finally(() => {
        if (!cancelled) setTrackingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Derive: is the picked action "ready enough" for conversion-based
  // bidding? The two readiness modes:
  //   - 'ready'   → fired in last 30 days OR (newly created AND tag
  //                 attested as installed). Full bidding unlocked.
  //   - 'learning'→ has a primary but no fire data yet. Conversion-based
  //                 bidding still allowed but with a warning.
  //   - 'blocked' → no primary picked, or primary is broken / has no
  //                 tag installed / has never fired. Only MAX_CLICKS.
  const primaryAction = useMemo(
    () => conversionActions.find((c) => c.id === primaryActionId) ?? null,
    [conversionActions, primaryActionId],
  );
  const trackingReadiness: "ready" | "learning" | "blocked" = useMemo(() => {
    if (!primaryAction) return "blocked";
    if (primaryAction.status !== "ENABLED") return "blocked";
    if (primaryAction.health === "working" || primaryAction.health === "stale")
      return "ready";
    if (primaryAction.health === "broken") return "blocked";
    // inactive — never fired
    return primaryAction.tagInstalled ? "learning" : "blocked";
  }, [primaryAction]);

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

  // -------- Wizard step navigation -------------------------------------
  // Five linear steps. The Brief step (0) is always available; steps 1-4
  // only become reachable once `draft && plan` exists (i.e. the user has
  // clicked Generate at least once).
  const [currentStep, setCurrentStep] = useState(0);
  useEffect(() => {
    // Auto-advance to Copy step the moment generation completes from the
    // Brief step — saves a click for the most common path.
    if (draft && plan && currentStep === 0) {
      setCurrentStep(1);
    }
  }, [draft, plan, currentStep]);

  // A7+B3: filter bidding options by channel; lock conversion-based ones
  // unless the picked primary action is at least in 'learning' state.
  const biddingOptions = useMemo(() => {
    const base = channel === "PMAX" ? PMAX_BIDDING_OPTIONS : SEARCH_BIDDING_OPTIONS;
    const allowConversionBased = trackingReadiness !== "blocked";
    return base.map((opt) => ({
      ...opt,
      enabled: opt.requiresTracking ? allowConversionBased : true,
    }));
  }, [channel, trackingReadiness]);

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
    !!landingPageUrl.trim() &&
    dailyBudgetUsd >= 1 &&
    !launching;

  // Manual mode toggle — pre-fill fields, lock channel to PMAX, and
  // synthesize a draft locally so the user can skip straight to launch.
  function applyManualMode(on: boolean) {
    setManualMode(on);
    if (on) {
      // Fresh HH:mm:ss suffix per toggle so retried launches never
      // collide on Google's "campaign name already exists" constraint.
      const brand = manualBrandNameWithSuffix();
      setBrandName(brand);
      setProductDescription(MANUAL_PRODUCT_DESCRIPTION);
      setLandingPageUrl(MANUAL_LANDING_URL);
      setChannel("PMAX");
      setDailyBudgetUsd(MANUAL_DEFAULT_BUDGET_USD);
      setPlan({
        sector: "Bookstore (manual test)",
        packId: "manual",
        packLabel: "Manual mock",
        packMode: "manual",
        masterPrompt: "(skipped — manual mode)",
      });
      setDraft(
        buildDraftFromCopy(
          { channel: "PMAX", clusters: [MANUAL_PMAX_CLUSTER] },
          brand,
        ),
      );
      setImageIds(null);
      setImageError(null);
      setError(null);
    } else {
      // Clear the synthetic state so the form looks pristine again.
      setBrandName("");
      setProductDescription("");
      setLandingPageUrl("");
      setDailyBudgetUsd(10);
      setPlan(null);
      setDraft(null);
      setImageIds(null);
    }
  }

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
    setImageError(null);

    // Copy + marketing images fire in parallel on the same click. Copy
    // gates the rest of the form revealing (sub-second). Image gen runs
    // independently and its own pending state drives the Images panel —
    // the user sees copy + form first, then images backfill ~10-15s
    // later. Logo is intentionally NOT generated here: it stays user-
    // driven via the Upload + Generate buttons on the logo slot card.
    startTransition(async () => {
      const res = await planAndGenerateCopy(briefPayload());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
      setDraft(buildDraftFromCopy(res.result, brandName));
    });

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
        prev ? mergePreservingEdits(prev, res.result) : null,
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
          ? mergePreservingEdits(prev, res.result)
          : buildDraftFromCopy(res.result, brandName),
      );
      setRefinement("");
    });
  }

  function onLaunch() {
    if (!draft || !canLaunch) return;
    setLaunchError(null);
    startLaunch(async () => {
      // Manual mode: ingest hand-cropped images from
      // public/manual-test-assets/ on the fly and use those IDs.
      // Skipped if the user already loaded them via "Load test images".
      let effectiveImageIds = imageIds;
      if (manualMode && !effectiveImageIds) {
        const load = await loadManualTestAssets(accountId || undefined);
        if (!load.ok) {
          setLaunchError(load.error);
          return;
        }
        effectiveImageIds = load.ids;
        setImageIds(load.ids);
      }
      const res = await launchCampaignFromCreate({
        brief: briefPayload(),
        channel,
        accountId,
        dailyBudgetUsd,
        audience: { country },
        ...(channel === "SEARCH"
          ? {
              // Phase A5 — pass clusters as-is. Each becomes an AdGroup
              // on Google with its own RSA + keyword set.
              searchClusters: draft.clusters
                .map((c) => ({
                  themeLabel: c.themeLabel,
                  intent: c.intent,
                  headlines: c.headlines
                    .map((h) => h.text.trim())
                    .filter(Boolean),
                  descriptions: c.descriptions
                    .map((d) => d.text.trim())
                    .filter(Boolean),
                  keywords: c.keywords
                    .map((k) => k.text.trim())
                    .filter(Boolean),
                }))
                .filter(
                  (c) =>
                    c.headlines.length >= 3 &&
                    c.descriptions.length >= 2 &&
                    c.keywords.length >= 1,
                ),
            }
          : {
              // Phase A5 PMAX — pass clusters. Each becomes an AssetGroup
              // on Google; images are shared across all groups.
              pmaxClusters: draft.pmaxClusters
                .map((c) => ({
                  themeLabel: c.themeLabel,
                  intent: c.intent,
                  businessName: c.businessName.text.trim(),
                  headlines: c.headlines
                    .map((h) => h.text.trim())
                    .filter(Boolean),
                  longHeadlines: c.longHeadlines
                    .map((h) => h.text.trim())
                    .filter(Boolean),
                  descriptions: c.descriptions
                    .map((d) => d.text.trim())
                    .filter(Boolean),
                }))
                .filter(
                  (c) =>
                    c.headlines.length >= 3 &&
                    c.longHeadlines.length >= 1 &&
                    c.descriptions.length >= 2 &&
                    c.businessName.length >= 1,
                ),
              assetIds: effectiveImageIds ?? undefined,
            }),
        // B3: the picked primary conversion action (server validates the
        // FK belongs to the account). NULL is allowed only when the
        // bidding strategy is MAXIMIZE_CLICKS; the picker enforces this.
        primaryConversionActionId: primaryActionId ?? undefined,
        // A6: minimal snapshot kept for audit context. We no longer
        // collect modes/events/valueType from the user here — the
        // /accounts/[id]/conversion-tracking hub captures all of that.
        conversionTracking: primaryAction
          ? {
              mode: "existing-site",
              events: [],
              valueType: "count-only",
              declaredValidated: trackingReadiness !== "blocked",
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

      {/* Two-column layout:
            Left  — wizard stepper + active step + nav
            Right — sticky live preview rail (appears after first generate)
          Mobile collapses to a single column. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <div className="min-w-0">
      <WizardStepper
        current={currentStep}
        onChange={setCurrentStep}
        unlocked={!!(draft && plan)}
      />

      {/* Step 1 — Brief (always renders; gates everything else) */}
      <div hidden={currentStep !== 0} className="mt-6">
      <form
        onSubmit={onSubmit}
        className="grid gap-5 rounded-2xl border border-border bg-card p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <Label className="text-[13px] font-medium">
            Brand name <span className="text-destructive">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <ManualModeToggle
              value={manualMode}
              onChange={applyManualMode}
              disabled={pending || launching}
            />
            <ChannelToggle
              value={channel}
              onChange={setChannel}
              disabled={pending || manualMode}
            />
          </div>
        </div>
        {manualMode && (
          <ManualModeHelp />
        )}
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

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {error}
          </p>
        )}

        {!manualMode && (
          <>
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
          </>
        )}
      </form>

      </div>

      {/* Steps 2-5 — only renderable after generation has produced a draft */}
      {draft && plan && (
        <>
          {/* Step 2 — Copy: plan badge + refinement chat + clusters */}
          <div hidden={currentStep !== 1} className="mt-6 grid gap-6">
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
            {!manualMode && (
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
            )}
          </div>

          {/* A10 — Refinement chat (Gemini-powered; skip in manual mode) */}
          {!manualMode && (
            <RefinementChat
              value={refinement}
              onChange={setRefinement}
              onSubmit={onRefine}
              pending={refining}
            />
          )}

          {/* SEARCH path — Phase A5 multi-ad-group: render one card per
              cluster. Each card edits its own headlines / descriptions /
              keywords independently. Cards collapse to keep the page
              scannable when there are 4-5 ad groups. */}
          {draft.channel === "SEARCH" && (
            <>
              {draft.clusters.map((cluster, idx) => (
                <ClusterCard
                  key={`${cluster.themeLabel}-${idx}`}
                  index={idx}
                  total={draft.clusters.length}
                  cluster={cluster}
                  onChange={(next) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            clusters: d.clusters.map((c, i) =>
                              i === idx ? next : c,
                            ),
                          }
                        : d,
                    )
                  }
                  onRemove={
                    draft.clusters.length > 1
                      ? () =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  clusters: d.clusters.filter(
                                    (_, i) => i !== idx,
                                  ),
                                }
                              : d,
                          )
                      : undefined
                  }
                />
              ))}
              {/* Add-cluster button — gives the user manual control to
                  add a 6th cluster (we cap at 5 in schema/launch). */}
              {draft.clusters.length < 5 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            clusters: [
                              ...d.clusters,
                              {
                                themeLabel: `Ad group ${d.clusters.length + 1}`,
                                intent: "",
                                headlines: [],
                                descriptions: [],
                                keywords: [],
                              },
                            ],
                          }
                        : d,
                    )
                  }
                  className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-2 text-[12px] font-medium text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-3.5" />
                  Add another ad group
                </button>
              )}
            </>
          )}

          {/* PMAX path — Phase A5 multi-asset-group. Each card edits
              one asset group's business name + headlines + long
              headlines + descriptions. Images live below (shared across
              every asset group). */}
          {draft.channel === "PMAX" && (
            <>
              {draft.pmaxClusters.map((cluster, idx) => (
                <PmaxClusterCard
                  key={`${cluster.themeLabel}-${idx}`}
                  index={idx}
                  total={draft.pmaxClusters.length}
                  cluster={cluster}
                  onChange={(next) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            pmaxClusters: d.pmaxClusters.map((c, i) =>
                              i === idx ? next : c,
                            ),
                          }
                        : d,
                    )
                  }
                  onRemove={
                    draft.pmaxClusters.length > 1
                      ? () =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  pmaxClusters: d.pmaxClusters.filter(
                                    (_, i) => i !== idx,
                                  ),
                                }
                              : d,
                          )
                      : undefined
                  }
                />
              ))}
              {/* Add-asset-group button — cap at 3 (PMAX best practice). */}
              {draft.pmaxClusters.length < 3 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            pmaxClusters: [
                              ...d.pmaxClusters,
                              {
                                themeLabel: `Asset group ${d.pmaxClusters.length + 1}`,
                                intent: "",
                                businessName: {
                                  text: d.brandName.text.slice(0, 25),
                                  edited: false,
                                },
                                headlines: [],
                                longHeadlines: [],
                                descriptions: [],
                              },
                            ],
                          }
                        : d,
                    )
                  }
                  className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-2 text-[12px] font-medium text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-3.5" />
                  Add another asset group
                </button>
              )}
            </>
          )}

          </div>

          {/* Step 3 — Images: 5-slot grid (auto-generated marketing,
              upload-or-generate logo, per-slot upload overrides). */}
          <div hidden={currentStep !== 2} className="mt-6 grid gap-6">
          {manualMode ? (
            <ManualAssetsPanel
              ids={imageIds}
              pending={imagePending}
              error={imageError}
              onLoad={() => {
                setImageError(null);
                startImageGen(async () => {
                  const res = await loadManualTestAssets(
                    accountId || undefined,
                  );
                  if (!res.ok) {
                    setImageError(res.error);
                    return;
                  }
                  setImageIds(res.ids);
                });
              }}
            />
          ) : (
            <ImagesPanel
              channel={draft.channel}
              mode={imageMode}
              onModeChange={setImageMode}
              ids={imageIds}
              pending={imagePending}
              error={imageError}
              onGenerate={onGenerateImages}
              brief={briefPayload()}
              accountId={accountId}
              onPatchIds={(patch) =>
                setImageIds((prev) => ({ ...(prev ?? {}), ...patch }))
              }
            />
          )}
          </div>

          {/* Step 4 — Targeting: country + account + budget + landing URL
              + conversion tracking + bidding strategy. */}
          <div hidden={currentStep !== 3} className="mt-6 grid gap-6">
          <Bucket2
            country={country}
            onCountryChange={setCountry}
            disabled={launching}
          />

          <Bucket3
            accounts={accounts}
            accountId={accountId}
            onAccountIdChange={setAccountId}
            dailyBudgetUsd={dailyBudgetUsd}
            onBudgetChange={setDailyBudgetUsd}
            landingPageUrl={landingPageUrl}
            onLandingPageUrlChange={setLandingPageUrl}
            disabled={launching}
          />

          <PrimaryGoalPicker
            accountId={accountId}
            actions={conversionActions}
            loading={trackingLoading}
            primaryActionId={primaryActionId}
            onPrimaryActionIdChange={setPrimaryActionId}
            readiness={trackingReadiness}
            disabled={launching}
          />

          <BiddingStrategySection
            channel={channel}
            options={biddingOptions}
            value={biddingStrategyId}
            onChange={setBiddingStrategyId}
            targetCpaUsd={targetCpaUsd}
            onTargetCpaChange={setTargetCpaUsd}
            targetRoas={targetRoas}
            onTargetRoasChange={setTargetRoas}
            readiness={trackingReadiness}
            disabled={launching}
          />
          </div>

          {/* Step 5 — Review & Launch */}
          <div hidden={currentStep !== 4} className="mt-6 grid gap-6">
          <ReviewAndLaunch
            channel={channel}
            brandName={brandName}
            accountLabel={
              accounts.find((a) => a.id === accountId)?.descriptiveName ?? "—"
            }
            country={country}
            dailyBudgetUsd={dailyBudgetUsd}
            hasImages={!!imageIds}
            manualMode={manualMode}
            canLaunch={canLaunch}
            launching={launching}
            launchError={launchError}
            onLaunch={onLaunch}
          />
          </div>
        </>
      )}

      <WizardNav
        current={currentStep}
        total={5}
        canBack={currentStep > 0}
        canNext={canAdvanceFromStep(currentStep, {
          hasDraft: !!(draft && plan),
          channel,
          imageIds,
          accountId,
          landingPageUrl,
          dailyBudgetUsd,
        })}
        onBack={() => setCurrentStep((s) => Math.max(0, s - 1))}
        onNext={() => setCurrentStep((s) => Math.min(4, s + 1))}
      />
        </div>

        {/* Right rail — live preview (the old /app/preview, inlined).
            Sticky on desktop so it stays in view as the user scrolls
            through buckets. On mobile it stacks below the form. */}
        {draft && (
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <PreviewRail
              brandName={brandName || "Your brand"}
              landingPageUrl={landingPageUrl}
              channel={draft.channel}
              firstHeadline={
                draft.channel === "SEARCH"
                  ? draft.clusters[0]?.headlines[0]?.text ?? ""
                  : draft.pmaxClusters[0]?.headlines[0]?.text ?? ""
              }
              firstLongHeadline={
                draft.channel === "PMAX"
                  ? draft.pmaxClusters[0]?.longHeadlines[0]?.text ?? ""
                  : ""
              }
              firstDescription={
                draft.channel === "SEARCH"
                  ? draft.clusters[0]?.descriptions[0]?.text ?? ""
                  : draft.pmaxClusters[0]?.descriptions[0]?.text ?? ""
              }
              imageIds={imageIds}
            />
          </aside>
        )}
      </div>
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
// Manual mode toggle + helpers — test-only. Bypasses Gemini so we can
// verify the Google Ads launch pipeline end-to-end without burning AI
// quota.
// ---------------------------------------------------------------------------

function ManualModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      title="Skip AI — pre-fill mock data and use images from public/manual-test-assets/"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
        value
          ? "border-amber-400/60 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <FlaskConical className="size-3" />
      {value ? "Manual mode ON" : "Manual mode"}
    </button>
  );
}

function ManualModeHelp() {
  return (
    <div className="rounded-md border border-amber-400/40 bg-amber-50/60 px-3 py-2.5 text-[12px] leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-200">
      <div className="font-semibold">Manual test mode</div>
      <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
        Skipping AI. Channel locked to PMAX. Mock bookstore brief loaded.
        Edit any field below. Make sure you&apos;ve dropped image files in{" "}
        <code className="rounded bg-amber-100/70 px-1 font-mono text-[11px] dark:bg-amber-500/15">
          public/manual-test-assets/
        </code>{" "}
        — see README.md in that folder for filenames + ratios. Files are
        ingested when you click Launch.
      </p>
    </div>
  );
}

function ManualAssetsPanel({
  ids,
  pending,
  error,
  onLoad,
}: {
  ids: GeneratedAssetIds | null;
  pending: boolean;
  error: string | null;
  onLoad: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <ImageIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">
            Manual test images
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            We read these files from{" "}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">
              public/manual-test-assets/
            </code>
            . Loading happens automatically on Launch; click below to load
            now if you want to preview first.
          </p>
        </div>
        {ids && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 className="size-3" />
            Loaded
          </span>
        )}
      </div>

      <ul className="mt-4 grid gap-1.5 text-[11.5px]">
        {MANUAL_ASSET_FILES.map((f) => (
          <li
            key={f.filename}
            className="flex items-center justify-between gap-3 rounded border border-border bg-background px-2.5 py-1.5"
          >
            <code className="font-mono text-[11px]">{f.filename}</code>
            <span className="shrink-0 text-muted-foreground">
              {f.ratio} · {f.recommendedSize}
              {!f.required && " · optional"}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {ids
            ? "Ingested as Asset rows. You're good to launch."
            : "Files stay on disk until ingested."}
        </p>
        <button
          type="button"
          onClick={onLoad}
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={cn("size-3.5", pending && "animate-spin")}
          />
          {pending ? "Loading…" : ids ? "Reload" : "Load test images now"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </p>
      )}
    </section>
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
// ClusterCard — A5 multi-ad-group editor.
//
// One card per theme cluster. Theme label is editable (just rename the
// ad group). Intent is informational. Headlines / descriptions /
// keywords are independently editable per cluster — keeping the same
// edit-preservation pattern.
// ---------------------------------------------------------------------------

function ClusterCard({
  index,
  total,
  cluster,
  onChange,
  onRemove,
}: {
  index: number;
  total: number;
  cluster: EditableCluster;
  onChange: (next: EditableCluster) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Ad group {index + 1} of {total}
            </span>
          </div>
          <Input
            value={cluster.themeLabel}
            onChange={(e) =>
              onChange({ ...cluster, themeLabel: e.target.value })
            }
            placeholder="Theme label (e.g. Branded, Informational)"
            maxLength={50}
            className="mt-1 h-9 font-semibold text-[14px]"
          />
          {cluster.intent && (
            <p className="mt-1.5 text-[11.5px] italic text-muted-foreground">
              {cluster.intent}
            </p>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove ad group"
            title="Remove this ad group"
            className="mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          >
            <span aria-hidden>×</span>
          </button>
        )}
      </header>

      <div className="mt-4 space-y-4">
        <ListField
          label="Headlines"
          required
          maxItems={12}
          maxLen={30}
          items={cluster.headlines}
          onChange={(headlines) => onChange({ ...cluster, headlines })}
        />
        <ListField
          label="Descriptions"
          required
          maxItems={4}
          maxLen={90}
          multiline
          items={cluster.descriptions}
          onChange={(descriptions) => onChange({ ...cluster, descriptions })}
        />
        <ListField
          label="Keywords"
          required
          maxItems={15}
          maxLen={80}
          items={cluster.keywords}
          onChange={(keywords) => onChange({ ...cluster, keywords })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PmaxClusterCard — A5 multi-asset-group editor (PMAX).
//
// Same shape as ClusterCard but for PMAX asset groups: business name +
// short headlines + long headlines + descriptions. No keywords (PMAX
// doesn't use them). Image assets live in the shared Images panel below
// and are linked to every asset group.
// ---------------------------------------------------------------------------

function PmaxClusterCard({
  index,
  total,
  cluster,
  onChange,
  onRemove,
}: {
  index: number;
  total: number;
  cluster: EditablePmaxCluster;
  onChange: (next: EditablePmaxCluster) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Asset group {index + 1} of {total}
            </span>
          </div>
          <Input
            value={cluster.themeLabel}
            onChange={(e) =>
              onChange({ ...cluster, themeLabel: e.target.value })
            }
            placeholder="Theme label (e.g. Researcher, Ready to buy)"
            maxLength={50}
            className="mt-1 h-9 font-semibold text-[14px]"
          />
          {cluster.intent && (
            <p className="mt-1.5 text-[11.5px] italic text-muted-foreground">
              {cluster.intent}
            </p>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove asset group"
            title="Remove this asset group"
            className="mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          >
            <span aria-hidden>×</span>
          </button>
        )}
      </header>

      <div className="mt-4 space-y-4">
        <SingleField
          label="Business name"
          required
          maxLen={25}
          field={cluster.businessName}
          onChange={(text) =>
            onChange({
              ...cluster,
              businessName: { text, edited: true },
            })
          }
        />
        <ListField
          label="Short headlines"
          required
          maxItems={15}
          maxLen={30}
          items={cluster.headlines}
          onChange={(headlines) => onChange({ ...cluster, headlines })}
        />
        <ListField
          label="Long headlines"
          required
          maxItems={5}
          maxLen={90}
          multiline
          items={cluster.longHeadlines}
          onChange={(longHeadlines) =>
            onChange({ ...cluster, longHeadlines })
          }
        />
        <ListField
          label="Descriptions"
          required
          maxItems={5}
          maxLen={90}
          multiline
          items={cluster.descriptions}
          onChange={(descriptions) => onChange({ ...cluster, descriptions })}
        />
      </div>
    </div>
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
  brief,
  accountId,
  onPatchIds,
}: {
  channel: Channel;
  mode: PipelineMode;
  onModeChange: (m: PipelineMode) => void;
  ids: GeneratedAssetIds | null;
  pending: boolean;
  error: string | null;
  onGenerate: () => void;
  brief: CreateBrief;
  accountId: string;
  onPatchIds: (patch: Partial<GeneratedAssetIds>) => void;
}) {
  function getAssetIdForRole(role: ImageSlotRole): string | undefined {
    if (!ids) return undefined;
    switch (role) {
      case "square_logo":
        return ids.logoAssetId;
      case "landscape_logo":
        return ids.landscapeLogoAssetId;
      case "marketing_image":
        return ids.marketingImageAssetId;
      case "square_marketing_image":
        return ids.squareMarketingImageAssetId;
      case "portrait_marketing_image":
        return ids.portraitMarketingImageAssetId;
    }
  }

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
              Marketing images generate automatically with your copy. For
              the logo, upload yours or click Generate on the logo card.
              Every slot accepts an upload override.
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
              : ids?.marketingImageAssetId
                ? "Regenerate marketing"
                : "Generate marketing images"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {IMAGE_SLOTS.map((slot) => (
          <ImageSlotCard
            key={slot.role}
            slot={slot}
            assetId={getAssetIdForRole(slot.role)}
            brief={brief}
            accountId={accountId}
            onPatchIds={onPatchIds}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single per-slot card: preview/placeholder + Upload (always) + Generate
// (logo slots only). Each upload runs through `validateImageFileForSlot`
// (mime + size + dims + aspect) before hitting the server. Logo Generate
// fills BOTH logo slots in one Gemini call.
// ---------------------------------------------------------------------------
function ImageSlotCard({
  slot,
  assetId,
  brief,
  accountId,
  onPatchIds,
}: {
  slot: ImageSlotSpec;
  assetId: string | undefined;
  brief: CreateBrief;
  accountId: string;
  onPatchIds: (patch: Partial<GeneratedAssetIds>) => void;
}) {
  const [uploading, startUpload] = useTransition();
  const [generating, startGenerate] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const previewUrl = assetId ? `/api/assets/${assetId}/bytes` : null;
  const busy = uploading || generating;

  function handleFile(file: File) {
    setLocalError(null);
    startUpload(async () => {
      const validation = await validateImageFileForSlot(file, slot);
      if (!validation.ok) {
        setLocalError(validation.error);
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("role", slot.role);
      if (accountId) formData.append("accountId", accountId);
      formData.append("label", brief.brandName || "campaign");

      const res = await uploadAssetForRoleAction(formData);
      if (!res.ok) {
        setLocalError(res.error);
        return;
      }
      onPatchIds(patchForRole(slot.role, res.assetId));
    });
  }

  function handleGenerateLogo() {
    setLocalError(null);
    startGenerate(async () => {
      const res = await generateLogoOnlyAction(brief, accountId || undefined);
      if (!res.ok) {
        setLocalError(res.error);
        return;
      }
      // One generation fills BOTH logo slots (Sharp produces both variants).
      onPatchIds({
        logoAssetId: res.logoAssetId,
        landscapeLogoAssetId: res.landscapeLogoAssetId,
      });
    });
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <div className="text-[12.5px] font-medium">{slot.label}</div>
        {!slot.required && (
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
            optional
          </span>
        )}
      </div>
      <p className="mb-2 text-[10.5px] text-muted-foreground">
        {slot.helperText}
      </p>

      <div
        className={cn(
          "mb-2 overflow-hidden rounded border",
          previewUrl
            ? "border-border bg-muted"
            : "border-dashed border-border/70 bg-muted/30",
        )}
        style={{ aspectRatio: String(slot.targetRatio) }}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={slot.label}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[10.5px] text-muted-foreground">
            {slot.isLogo
              ? "Upload your logo or click Generate"
              : "Generating…"}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "Uploading…" : previewUrl ? "Replace" : "Upload"}
        </button>
        {slot.isLogo && (
          <button
            type="button"
            onClick={handleGenerateLogo}
            disabled={busy || !brief.brandName.trim()}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title={
              !brief.brandName.trim()
                ? "Enter a brand name above first"
                : "Generate a logo for you"
            }
          >
            <Sparkles className="size-3" />
            {generating ? "Generating…" : "Generate"}
          </button>
        )}
      </div>

      {localError && (
        <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10.5px] text-destructive">
          {localError}
        </p>
      )}
    </div>
  );
}

function patchForRole(
  role: ImageSlotRole,
  assetId: string,
): Partial<GeneratedAssetIds> {
  switch (role) {
    case "square_logo":
      return { logoAssetId: assetId };
    case "landscape_logo":
      return { landscapeLogoAssetId: assetId };
    case "marketing_image":
      return { marketingImageAssetId: assetId };
    case "square_marketing_image":
      return { squareMarketingImageAssetId: assetId };
    case "portrait_marketing_image":
      return { portraitMarketingImageAssetId: assetId };
  }
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
  landingPageUrl,
  onLandingPageUrlChange,
  disabled,
}: {
  accounts: LaunchableAccount[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
  dailyBudgetUsd: number;
  onBudgetChange: (n: number) => void;
  landingPageUrl: string;
  onLandingPageUrlChange: (s: string) => void;
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

          {/* Landing page URL — moved here from the widget bar because
              it's a "you decide" field (Google requires a finalUrl on
              every ad). Asking later keeps the entry point lean. */}
          <div className="mt-4 grid gap-2">
            <Label className="text-[12px] font-medium">
              Landing page URL <span className="text-destructive">*</span>
            </Label>
            <Input
              type="url"
              value={landingPageUrl}
              onChange={(e) => onLandingPageUrlChange(e.target.value)}
              placeholder="https://yourbrand.com/shop"
              disabled={disabled}
              className="h-10"
            />
            <p className="text-[11px] text-muted-foreground">
              The page Google sends clicks to. Required.
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
  manualMode,
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
  manualMode: boolean;
  canLaunch: boolean;
  launching: boolean;
  launchError: string | null;
  onLaunch: () => void;
}) {
  // In manual mode the launch flow ingests images from
  // public/manual-test-assets/ on click, so we don't need to block on
  // hasImages here — the server action validates the files exist and
  // returns a clean error if any required one is missing.
  const needsImagesForPmax = channel === "PMAX" && !hasImages && !manualMode;

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
          value={
            hasImages
              ? "Loaded"
              : manualMode
                ? "From manual-test-assets/ (on launch)"
                : "Not generated"
          }
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
// PreviewRail
//
// Live ad preview — sticky on the right of /app/create. Renders the
// current draft (first headline / description / images) inside the same
// Google placement mocks the old /app/preview page used (Search SERP,
// Display banner, Discover card). Tabs let the user flip between
// placements.
// ---------------------------------------------------------------------------

type PreviewTab = "search" | "display" | "discover";

function PreviewRail({
  brandName,
  landingPageUrl,
  channel,
  firstHeadline,
  firstLongHeadline,
  firstDescription,
  imageIds,
}: {
  brandName: string;
  landingPageUrl: string;
  channel: Channel;
  firstHeadline: string;
  firstLongHeadline: string;
  firstDescription: string;
  imageIds: GeneratedAssetIds | null;
}) {
  const [tab, setTab] = useState<PreviewTab>("search");

  const landingDomain = useMemo(() => {
    const tryUrl = landingPageUrl.trim();
    if (tryUrl) {
      try {
        return new URL(tryUrl).hostname.replace(/^www\./, "");
      } catch {
        // fall through to slug
      }
    }
    const slug = brandName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24);
    return `${slug || "yourbrand"}.com`;
  }, [landingPageUrl, brandName]);

  const adContent = {
    brandName,
    landingDomain,
    headline: firstHeadline || brandName,
    description: firstDescription,
    longHeadline: firstLongHeadline || null,
    heroUrl: imageIds?.marketingImageAssetId
      ? `/api/assets/${imageIds.marketingImageAssetId}/bytes`
      : undefined,
    squareUrl: imageIds?.squareMarketingImageAssetId
      ? `/api/assets/${imageIds.squareMarketingImageAssetId}/bytes`
      : undefined,
    logoUrl: imageIds?.logoAssetId
      ? `/api/assets/${imageIds.logoAssetId}/bytes`
      : undefined,
  };

  return (
    <div className="space-y-3">
      {/* Header — title + small "AI" badge so the user knows this
          reflects the current draft + auto-updates as they edit. */}
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold tracking-tight">
          Live preview
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {channel} · updates as you edit
        </span>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Preview placement"
        className="inline-flex rounded-md border border-border bg-background p-0.5"
      >
        {(
          [
            { id: "search", label: "Search" },
            { id: "display", label: "Display" },
            { id: "discover", label: "Discover" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded px-3 py-1 text-[11.5px] font-medium transition-colors",
              tab === t.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Render the picked mockup */}
      <div>
        {tab === "search" && <SearchSerpMockup content={adContent} />}
        {tab === "display" && <DisplayBannerMockup content={adContent} />}
        {tab === "discover" && <DiscoverCardMockup content={adContent} />}
      </div>
    </div>
  );
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
// B3 — Primary goal picker
//
// Shows every ConversionAction on the chosen account (imported during
// Phase 8a + created via the Hub). The user picks ONE — that FK lands
// on the new Campaign row and tells the optimizer what to bid for.
//
// Readiness modes (computed in CreateForm, displayed here):
//   - 'ready'    → green badge, all bidding strategies unlocked
//   - 'learning' → amber badge, conversion-based bidding allowed but
//                  warned (no fire data yet)
//   - 'blocked'  → red/grey, only Maximize Clicks is allowed
//
// "+ Add conversion" deep-links to /app/accounts/[id]/conversion-
// tracking in a new tab. The customer creates the action there, comes
// back, the picker re-fetches on next paint (currently they hit
// "Refresh tracking" — auto-refresh on focus is a TODO).
// ---------------------------------------------------------------------------

function PrimaryGoalPicker({
  accountId,
  actions,
  loading,
  primaryActionId,
  onPrimaryActionIdChange,
  readiness,
  disabled,
}: {
  accountId: string;
  actions: ConversionActionOption[];
  loading: boolean;
  primaryActionId: string | null;
  onPrimaryActionIdChange: (id: string | null) => void;
  readiness: "ready" | "learning" | "blocked";
  disabled?: boolean;
}) {
  const router = useRouter();
  const hasAccount = !!accountId;
  const enabledActions = actions.filter((a) => a.status === "ENABLED");
  const hubHref = accountId
    ? `/app/accounts/${accountId}/conversion-tracking`
    : undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px] font-medium">
          Conversion tracking{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            hard gate
          </span>
        </Label>
        <ReadinessBadge readiness={readiness} />
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Pick which conversion this campaign should optimize for. Without
        one, only Maximize Clicks bidding is available — Google has no
        signal to chase.
      </p>

      {!hasAccount && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-800">
          Pick an account in Bucket 3 above first.
        </div>
      )}

      {hasAccount && loading && (
        <div className="mt-4 text-[12px] text-muted-foreground">
          Loading conversion actions…
        </div>
      )}

      {hasAccount && !loading && enabledActions.length === 0 && (
        <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-4 text-center">
          <Target className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-[12.5px] font-medium">
            No conversion actions on this account
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Add one in the tracking hub — paste a gtag snippet on your
            site or set up phone-call tracking. Takes a minute.
          </p>
          {hubHref && (
            <a
              href={hubHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[12px] font-medium text-background hover:bg-foreground/85"
            >
              <Plus className="size-3" />
              Set up tracking
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {hasAccount && !loading && enabledActions.length > 0 && (
        <div className="mt-4 grid gap-2">
          {enabledActions.map((a) => {
            const picked = a.id === primaryActionId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onPrimaryActionIdChange(a.id)}
                disabled={disabled}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  picked
                    ? "border-foreground bg-foreground/[0.04]"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <ActionHealthDot health={a.health} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
                    {a.name}
                    {a.isPrimary && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                        <Star className="size-2.5 fill-current" />
                        primary
                      </span>
                    )}
                    {a.tagInstalled && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700">
                        tag installed
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {a.category} · {a.reason}
                  </div>
                </div>
                {picked && (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground" />
                )}
              </button>
            );
          })}
          <div className="mt-1 flex items-center justify-between gap-3">
            {hubHref && (
              <a
                href={hubHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted"
              >
                <Plus className="size-3" />
                Add new conversion
                <ExternalLink className="size-3" />
              </a>
            )}
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex h-7 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Readiness explainer */}
      {hasAccount && readiness === "learning" && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-800">
          <Clock className="mr-1 inline size-3" />
          Tag attested but no fires recorded yet. Google will start in
          learning mode — expect noisy spend for ~2 weeks until enough
          conversions accumulate.
        </p>
      )}
      {hasAccount && readiness === "blocked" && primaryActionId && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-[11px] text-destructive">
          <XCircle className="mr-1 inline size-3" />
          This action is broken or has never fired and the tag isn&apos;t
          marked installed. Repair or pick another to unlock smart bidding.
        </p>
      )}
    </div>
  );
}

function ReadinessBadge({
  readiness,
}: {
  readiness: "ready" | "learning" | "blocked";
}) {
  if (readiness === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
        <CheckCircle2 className="size-2.5" />
        ready
      </span>
    );
  }
  if (readiness === "learning") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        <Clock className="size-2.5" />
        learning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-muted bg-muted px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <HelpCircle className="size-2.5" />
      not set
    </span>
  );
}

function ActionHealthDot({
  health,
}: {
  health: ConversionActionOption["health"];
}) {
  const color =
    health === "working"
      ? "bg-emerald-500"
      : health === "stale"
        ? "bg-amber-500"
        : health === "broken"
          ? "bg-destructive"
          : "bg-muted-foreground/50";
  return (
    <span
      title={health}
      className={cn("mt-1.5 size-2 shrink-0 rounded-full", color)}
    />
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
  readiness,
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
  readiness: "ready" | "learning" | "blocked";
  disabled?: boolean;
}) {
  const current = options.find((o) => o.id === value);
  const helper =
    readiness === "ready"
      ? "Tracking is firing — all strategies available."
      : readiness === "learning"
        ? "Smart bidding allowed in learning mode (no fire data yet — expect ~2 weeks of noisy spend)."
        : "Pick a working primary goal above to unlock conversion-based bidding.";
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
      <p className="mt-1 text-[11.5px] text-muted-foreground">{helper}</p>

      {channel === "PMAX" && readiness === "blocked" && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-800">
          <Target className="mr-1 inline size-3" />
          PMAX requires conversion tracking. Set up a working primary
          conversion above before launching.
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
//
// `ServerCopy` mirrors the discriminated `CopyResult` from actions.ts:
//   • SEARCH → an array of theme clusters (Phase A5 multi-ad-group)
//   • PMAX   → flat ad copy (single asset group for v1)
// ---------------------------------------------------------------------------

type ServerCopy =
  | { channel: "SEARCH"; clusters: ThemeCluster[] }
  | { channel: "PMAX"; clusters: PmaxAssetGroupCluster[] };

function buildDraftFromCopy(c: ServerCopy, brandName: string): DraftCopy {
  if (c.channel === "PMAX") {
    return {
      channel: "PMAX",
      brandName: { text: brandName, edited: false },
      clusters: [],
      pmaxClusters: c.clusters.map((cluster) => ({
        themeLabel: cluster.themeLabel,
        intent: cluster.intent,
        businessName: {
          text: cluster.businessName || brandName.slice(0, 25),
          edited: false,
        },
        headlines: cluster.headlines.map((text) => ({ text, edited: false })),
        longHeadlines: cluster.longHeadlines.map((text) => ({
          text,
          edited: false,
        })),
        descriptions: cluster.descriptions.map((text) => ({
          text,
          edited: false,
        })),
      })),
    };
  }
  return {
    channel: "SEARCH",
    brandName: { text: brandName, edited: false },
    pmaxClusters: [],
    clusters: c.clusters.map((cluster) => ({
      themeLabel: cluster.themeLabel,
      intent: cluster.intent,
      headlines: cluster.headlines.map((text) => ({ text, edited: false })),
      descriptions: cluster.descriptions.map((text) => ({
        text,
        edited: false,
      })),
      keywords: cluster.keywords.map((text) => ({ text, edited: false })),
    })),
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
    // Same cluster-match-by-themeLabel pattern as SEARCH below — keeps
    // manual edits inside each asset-group card across re-rolls.
    const merged: EditablePmaxCluster[] = fresh.clusters.map((freshC) => {
      const prevC = prev.pmaxClusters.find(
        (p) => p.themeLabel.toLowerCase() === freshC.themeLabel.toLowerCase(),
      );
      if (!prevC) {
        return {
          themeLabel: freshC.themeLabel,
          intent: freshC.intent,
          businessName: {
            text: freshC.businessName || prev.brandName.text.slice(0, 25),
            edited: false,
          },
          headlines: freshC.headlines.map((t) => ({ text: t, edited: false })),
          longHeadlines: freshC.longHeadlines.map((t) => ({
            text: t,
            edited: false,
          })),
          descriptions: freshC.descriptions.map((t) => ({
            text: t,
            edited: false,
          })),
        };
      }
      return {
        themeLabel: prevC.themeLabel,
        intent: prevC.intent || freshC.intent,
        businessName: prevC.businessName.edited
          ? prevC.businessName
          : {
              text: freshC.businessName || prev.brandName.text.slice(0, 25),
              edited: false,
            },
        headlines: mergeList(prevC.headlines, freshC.headlines),
        longHeadlines: mergeList(prevC.longHeadlines, freshC.longHeadlines),
        descriptions: mergeList(prevC.descriptions, freshC.descriptions),
      };
    });
    return { ...prev, pmaxClusters: merged };
  }
  if (fresh.channel === "SEARCH" && prev.channel === "SEARCH") {
    const merged: EditableCluster[] = fresh.clusters.map((freshC) => {
      const prevC = prev.clusters.find(
        (p) => p.themeLabel.toLowerCase() === freshC.themeLabel.toLowerCase(),
      );
      if (!prevC) {
        return {
          themeLabel: freshC.themeLabel,
          intent: freshC.intent,
          headlines: freshC.headlines.map((t) => ({ text: t, edited: false })),
          descriptions: freshC.descriptions.map((t) => ({
            text: t,
            edited: false,
          })),
          keywords: freshC.keywords.map((t) => ({ text: t, edited: false })),
        };
      }
      return {
        themeLabel: prevC.themeLabel,
        intent: prevC.intent || freshC.intent,
        headlines: mergeList(prevC.headlines, freshC.headlines),
        descriptions: mergeList(prevC.descriptions, freshC.descriptions),
        keywords: mergeList(prevC.keywords, freshC.keywords),
      };
    });
    return { ...prev, clusters: merged };
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

// ---------------------------------------------------------------------------
// Wizard navigation — Stepper (top) + Next/Back nav (bottom)
// ---------------------------------------------------------------------------

const WIZARD_STEP_LABELS = [
  "Brief",
  "Copy",
  "Images",
  "Targeting",
  "Review & Launch",
] as const;

function WizardStepper({
  current,
  onChange,
  unlocked,
}: {
  current: number;
  onChange: (n: number) => void;
  /** True once `draft && plan` exists — steps 1-4 stay locked until then. */
  unlocked: boolean;
}) {
  return (
    <nav
      aria-label="Campaign creation steps"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
    >
      {WIZARD_STEP_LABELS.map((label, i) => {
        const isCurrent = i === current;
        const isCompleted = i < current;
        const isReachable = i === 0 || unlocked;
        return (
          <button
            key={label}
            type="button"
            onClick={() => isReachable && onChange(i)}
            disabled={!isReachable}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
              isCurrent
                ? "bg-foreground text-background"
                : isCompleted
                  ? "border border-border bg-background text-foreground hover:bg-muted"
                  : isReachable
                    ? "border border-border bg-background text-muted-foreground hover:bg-muted"
                    : "border border-dashed border-border bg-background/40 text-muted-foreground/50 cursor-not-allowed",
            )}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full text-[10.5px] font-mono",
                isCurrent
                  ? "bg-background/20"
                  : isCompleted
                    ? "bg-foreground text-background"
                    : "border border-border",
              )}
            >
              {isCompleted ? <CheckCircle2 className="size-3" /> : i + 1}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function WizardNav({
  current,
  total,
  canBack,
  canNext,
  onBack,
  onNext,
}: {
  current: number;
  total: number;
  canBack: boolean;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const isLast = current === total - 1;
  return (
    <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[12.5px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Back
      </button>
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        Step {current + 1} of {total}
      </div>
      {!isLast && (
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-4 text-[12.5px] font-medium text-background hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      )}
      {isLast && (
        <div className="text-[11.5px] text-muted-foreground">
          Use the Create button above to launch.
        </div>
      )}
    </div>
  );
}

/**
 * Per-step validation gate — controls whether the Next button is active.
 * Step 1 (Brief) requires that generation has completed (draft && plan).
 * Step 3 (Images) gates PMax behind logo + marketing image presence.
 * Step 4 (Targeting) requires account + URL + budget.
 * Step 5 has no Next (Launch button handles its own gating).
 */
function canAdvanceFromStep(
  step: number,
  ctx: {
    hasDraft: boolean;
    channel: "SEARCH" | "PMAX";
    imageIds: GeneratedAssetIds | null;
    accountId: string;
    landingPageUrl: string;
    dailyBudgetUsd: number;
  },
): boolean {
  switch (step) {
    case 0:
      // Can only leave Brief once generation has produced a draft.
      return ctx.hasDraft;
    case 1:
      // Copy step — always allow leaving (per-cluster minimums are
      // enforced in the launch payload filter).
      return true;
    case 2:
      // Images — PMax needs logo + marketing image (the launcher hard-
      // enforces this; we mirror it here so the Next button is honest).
      if (ctx.channel !== "PMAX") return true;
      return (
        !!ctx.imageIds?.logoAssetId && !!ctx.imageIds?.marketingImageAssetId
      );
    case 3:
      return (
        !!ctx.accountId &&
        !!ctx.landingPageUrl.trim() &&
        ctx.dailyBudgetUsd >= 1
      );
    default:
      return false;
  }
}
