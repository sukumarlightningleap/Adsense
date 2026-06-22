"use server";

/**
 * Server actions for the autopilot /app/create flow.
 *
 *   - planAndGenerateCopy()  — first action when the user submits the
 *     widget bar. Runs the architect (style pack + sector pick) and copy
 *     generator in parallel. Returns enough to populate Bucket 1.
 *
 *   - regenerateCopy()  — per-section "Regenerate" buttons. Re-runs
 *     only the copy generator (cheap), preserves the architect's plan +
 *     any fields the user has manually edited (the client filters those
 *     out before merging the response).
 *
 *   - generateImagesAction()  — kicks off the image pipeline (simple or
 *     refined), persists master + logo as Asset rows, returns the IDs.
 *     Slow (~10-25s). Idempotent — re-runs just create new Asset rows.
 *
 *   - launchCampaignFromCreate()  — translates the autopilot draft into
 *     the wizard's `CampaignDraft` shape, validates it, and creates the
 *     Campaign row as PAUSED. Returns the new campaign's id so the
 *     client can redirect to its detail page (where the existing
 *     LaunchCard pushes it live to Google).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { planCampaign, type CampaignPlan } from "@/lib/ai/architect";
import { persistGeneratedImage } from "@/lib/ai/asset-persistence";
import {
  generateClusteredPmaxCopy,
  generateClusteredSearchCopy,
} from "@/lib/ai/copy-generator";
import { GeminiKeyError } from "@/lib/ai/gemini-client";
import {
  generateAssetsForBrief,
  type GeneratedAssetIds,
  type PipelineMode,
} from "@/lib/ai/pipeline";
import type {
  AdBrief,
  PmaxAssetGroupCluster,
  ThemeCluster,
} from "@/lib/ai/types";
import { buildLaunchPayload } from "@/lib/wizard/payload-builder";
import {
  FullDraftSchema,
  type CampaignDraft,
  type CountryCode,
} from "@/lib/wizard/schema";
import { buildCampaignYaml } from "@/lib/wizard/yaml-builder";

import { MANUAL_ASSET_FILES } from "./manual-mode";

export type CreateBrief = {
  brandName: string;
  productDescription: string;
  landingPageUrl?: string;
  channel?: "SEARCH" | "PMAX";   // optional override; architect picks otherwise
};

export type PlanSummary = {
  sector: string;
  packId: string;
  packLabel: string;
  packMode: string;
  masterPrompt: string;
};

/**
 * Channel-discriminated copy result.
 *
 *   SEARCH → returns 1-5 theme clusters (Phase A5 multi-ad-group)
 *   PMAX   → returns flat copy (single asset group for v1)
 */
export type CopyResult =
  | { channel: "SEARCH"; clusters: ThemeCluster[] }
  | { channel: "PMAX"; clusters: PmaxAssetGroupCluster[] };

export type PlanAndGenerateResult =
  | {
      ok: true;
      plan: PlanSummary;
      result: CopyResult;
      brief: AdBrief;
    }
  | { ok: false; error: string };

export async function planAndGenerateCopy(
  input: CreateBrief,
): Promise<PlanAndGenerateResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't run Create Campaign." };
  }

  const brandName = input.brandName.trim();
  const productDescription = input.productDescription.trim();
  if (!brandName || productDescription.length < 10) {
    return {
      ok: false,
      error:
        "Add a brand name and at least a few sentences about what you're advertising.",
    };
  }

  const channel = input.channel ?? "SEARCH";
  const brief: AdBrief = {
    channel,
    brandName,
    productDescription,
    landingPageUrl: input.landingPageUrl?.trim() ?? "",
  };

  try {
    // Run architect + copy in parallel. Both channels now use clustered
    // generators (Phase A5):
    //   SEARCH → 1-5 ad-group clusters
    //   PMAX   → 1-3 asset-group clusters
    const [plan, clusters] = await Promise.all([
      planCampaign(brief),
      channel === "SEARCH"
        ? generateClusteredSearchCopy(brief)
        : generateClusteredPmaxCopy(brief),
    ]);

    const result: CopyResult =
      channel === "SEARCH"
        ? {
            channel: "SEARCH",
            clusters: (clusters as Awaited<
              ReturnType<typeof generateClusteredSearchCopy>
            >).clusters,
          }
        : {
            channel: "PMAX",
            clusters: (clusters as Awaited<
              ReturnType<typeof generateClusteredPmaxCopy>
            >).clusters,
          };

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ai.create_campaign_plan",
        targetKind: "campaign",
        targetId: null,
        payload: {
          brandName,
          channel,
          sector: plan.sector,
          packId: plan.pack.id,
          groupCount: result.clusters.length,
        },
      },
    });

    return { ok: true, plan: summarizePlan(plan), result, brief };
  } catch (e) {
    if (e instanceof GeminiKeyError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Generation failed unexpectedly.",
    };
  }
}

export type RegenerateCopyResult =
  | { ok: true; result: CopyResult }
  | { ok: false; error: string };

/**
 * Re-run copy generation only — cheap (~2s). The client filters out any
 * field the user has manually edited and only merges the rest, so this
 * doesn't blow away inline edits.
 */
export async function regenerateCopy(
  input: CreateBrief,
): Promise<RegenerateCopyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't regenerate copy." };
  }

  const brandName = input.brandName.trim();
  const productDescription = input.productDescription.trim();
  if (!brandName || productDescription.length < 10) {
    return { ok: false, error: "Brief is incomplete." };
  }

  const channel = input.channel ?? "SEARCH";
  const brief: AdBrief = {
    channel,
    brandName,
    productDescription,
    landingPageUrl: input.landingPageUrl?.trim() ?? "",
  };

  try {
    const result: CopyResult =
      channel === "SEARCH"
        ? {
            channel: "SEARCH",
            clusters: (await generateClusteredSearchCopy(brief)).clusters,
          }
        : {
            channel: "PMAX",
            clusters: (await generateClusteredPmaxCopy(brief)).clusters,
          };
    return { ok: true, result };
  } catch (e) {
    if (e instanceof GeminiKeyError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Regeneration failed.",
    };
  }
}

function summarizePlan(p: CampaignPlan): PlanSummary {
  return {
    sector: p.sector,
    packId: p.pack.id,
    packLabel: p.pack.label,
    packMode: p.pack.mode,
    masterPrompt: p.prompts.master,
  };
}

// ===========================================================================
// Image generation — async, optional, called from the "Generate images"
// button. Cheap to swap modes by re-running.
// ===========================================================================

export type GenerateImagesResult =
  | { ok: true; ids: GeneratedAssetIds; mode: PipelineMode }
  | { ok: false; error: string };

export async function generateImagesAction(
  input: CreateBrief,
  mode: PipelineMode = "fast",
  accountId?: string,
): Promise<GenerateImagesResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't generate images." };
  }

  const brandName = input.brandName.trim();
  const productDescription = input.productDescription.trim();
  if (!brandName || productDescription.length < 10) {
    return { ok: false, error: "Brief is incomplete." };
  }

  // If the user has picked an account in Bucket 3, tag the assets to
  // that account. Otherwise leave them as org-wide library entries.
  let accountIdToUse: string | null = null;
  if (accountId) {
    const account = await db.adsAccount.findFirst({
      where: { id: accountId, userId: session.user.id, demoMode: false },
      select: { id: true },
    });
    accountIdToUse = account?.id ?? null;
  }

  try {
    const ids = await generateAssetsForBrief(
      {
        channel: input.channel ?? "SEARCH",
        brandName,
        productDescription,
        landingPageUrl: input.landingPageUrl?.trim() ?? "",
      },
      {
        userId: session.user.id,
        accountId: accountIdToUse,
        mode,
      },
    );
    revalidatePath("/app/assets");
    return { ok: true, ids, mode };
  } catch (e) {
    if (e instanceof GeminiKeyError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Image generation failed.",
    };
  }
}

// ===========================================================================
// Manual test mode — bypasses Gemini entirely. Reads hand-cropped image
// files from `public/manual-test-assets/`, ingests each as an Asset row
// tree (parent + Sharp-resized variants), and returns the per-slot IDs
// the PMax adapter expects. Used by the "Manual mode" toggle on the
// Create Campaign page to drive an end-to-end Google Ads launch test
// without burning AI quota.
// ===========================================================================

export type LoadManualAssetsResult =
  | { ok: true; ids: GeneratedAssetIds; loaded: string[]; skipped: string[] }
  | { ok: false; error: string };

export async function loadManualTestAssets(
  accountId?: string,
): Promise<LoadManualAssetsResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't run manual mode." };
  }

  let accountIdToUse: string | null = null;
  if (accountId) {
    const account = await db.adsAccount.findFirst({
      where: { id: accountId, userId: session.user.id, demoMode: false },
      select: { id: true },
    });
    accountIdToUse = account?.id ?? null;
  }

  const ids: GeneratedAssetIds = {};
  const loaded: string[] = [];
  const skipped: string[] = [];

  for (const spec of MANUAL_ASSET_FILES) {
    const fullPath = join(process.cwd(), "public", "manual-test-assets", spec.filename);
    let bytes: Buffer;
    try {
      bytes = await readFile(fullPath);
    } catch {
      if (spec.required) {
        return {
          ok: false,
          error: `Missing required image \`${spec.filename}\` in public/manual-test-assets/. See README.md in that folder.`,
        };
      }
      skipped.push(spec.filename);
      continue;
    }

    if (bytes.byteLength > 5 * 1024 * 1024) {
      return {
        ok: false,
        error: `\`${spec.filename}\` exceeds Google's 5 MB image asset cap (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB). Re-export smaller.`,
      };
    }

    const mime = spec.filename.endsWith(".png")
      ? "image/png"
      : spec.filename.endsWith(".jpg") || spec.filename.endsWith(".jpeg")
        ? "image/jpeg"
        : "application/octet-stream";

    const parentId = await persistGeneratedImage(
      {
        bytes,
        mimeType: mime,
        promptUsed: `Manual test asset: ${spec.filename}`,
      },
      {
        userId: session.user.id,
        accountId: accountIdToUse,
        isLogo: spec.isLogo,
        label: `Manual · ${spec.label}`,
        auditSource: "manual-test-assets",
      },
    );
    loaded.push(spec.filename);

    switch (spec.slot) {
      case "logoSquare":
        ids.logoAssetId = parentId;
        break;
      case "logoLandscape":
        ids.landscapeLogoAssetId = parentId;
        break;
      case "marketingLandscape":
        ids.marketingImageAssetId = parentId;
        break;
      case "marketingSquare":
        ids.squareMarketingImageAssetId = parentId;
        break;
      case "marketingPortrait":
        ids.portraitMarketingImageAssetId = parentId;
        break;
    }
  }

  return { ok: true, ids, loaded, skipped };
}

// ===========================================================================
// User accounts — Bucket 3 needs a picker. Live (non-demo) accounts
// only, and we filter out manager accounts because you can't launch
// campaigns onto an MCC.
// ===========================================================================

export type LaunchableAccount = {
  id: string;
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  isLegacy: boolean; // no OAuth token attached — env credentials
};

export async function listLaunchableAccounts(): Promise<LaunchableAccount[]> {
  const session = await auth();
  if (!session?.user) return [];

  const rows = await db.adsAccount.findMany({
    where: {
      userId: session.user.id,
      demoMode: false,
      isManager: false,
    },
    select: {
      id: true,
      customerId: true,
      descriptiveName: true,
      currencyCode: true,
      oauthRefreshToken: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    descriptiveName: r.descriptiveName ?? `Customer ${r.customerId}`,
    currencyCode: r.currencyCode,
    isLegacy: !r.oauthRefreshToken,
  }));
}

// ===========================================================================
// Conversion action picker — Phase B3.
//
// The Create-form reads the chosen account's ConversionAction rows so
// the customer can pick which one this campaign should optimize for.
// We include enough state (health + tagInstalled) for the form to
// compute whether each option is "ready" or "learning" without a
// second round-trip.
// ===========================================================================

export type ConversionActionOption = {
  id: string;
  name: string;
  category: string;
  status: string;
  isPrimary: boolean;
  /** 'working' | 'stale' | 'broken' | 'inactive' (per health.ts). */
  health: "working" | "stale" | "broken" | "inactive";
  reason: string;
  tagInstalled: boolean;
  providerConversionId: string | null;
};

export async function listConversionActionsForAccount(
  accountId: string,
): Promise<ConversionActionOption[]> {
  const session = await auth();
  if (!session?.user) return [];

  // Cheap ownership check first.
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return [];

  // Lazy import to avoid pulling lib into the create-page bundle when
  // the user hasn't picked an account yet.
  const { getConversionHealthForAccount } = await import(
    "@/lib/google-ads/health"
  );
  const healthRows = await getConversionHealthForAccount({ accountId });

  // We need tagInstalled too — pull it in one quick query.
  const tagRows = await db.conversionAction.findMany({
    where: { accountId },
    select: { id: true, tagInstalled: true },
  });
  const tagById = new Map(tagRows.map((r) => [r.id, r.tagInstalled]));

  return healthRows
    .filter((h) => h.status !== "REMOVED")
    .map((h) => ({
      id: h.id,
      name: h.name,
      category: h.category,
      status: h.status,
      isPrimary: h.isPrimary,
      health: h.health,
      reason: h.reason,
      tagInstalled: tagById.get(h.id) ?? false,
      providerConversionId: h.providerConversionId,
    }));
}

// ===========================================================================
// Launch — translate the autopilot draft into the wizard's CampaignDraft
// shape, validate, and create the Campaign row as PAUSED. Returns the
// new campaign id so the client can navigate to its detail page (where
// the existing LaunchCard pushes it live to Google).
// ===========================================================================

// ---------------------------------------------------------------------------
// Conversion tracking (Phase A6) — UI captures the customer's setup
// choices and we forward them into the audit log + (eventually) into the
// real tag / GTM / CRM / phone-tracking provisioning flows.
//
// For v1 we don't actually fire the integrations; we just record the
// customer's stated setup so the wizard schema accepts it and Phase
// 8c / 9 can pick up the work later. `declaredValidated` is the gate —
// only when the user explicitly confirms tracking is live do we let
// conversion-based bidding unlock (Phase A7).
// ---------------------------------------------------------------------------
export type ConversionTrackingInput = {
  mode: "hosted" | "existing-site" | "crm" | "phone";
  events: string[];                       // e.g. ['form_submit','page_view_thanks']
  valueType: "fixed" | "variable" | "count-only";
  valueAmount?: number;                   // USD; only when valueType='fixed'
  declaredValidated: boolean;             // user attestation; real validate-test-event lands in Phase 8c
};

// ---------------------------------------------------------------------------
// Bidding strategy (Phase A7) — gated on conversion tracking validation.
// ---------------------------------------------------------------------------
export type BiddingStrategyInput = {
  strategy:
    | "MAXIMIZE_CLICKS"
    | "MAXIMIZE_CONVERSIONS"
    | "MAXIMIZE_CONVERSION_VALUE"
    | "TARGET_CPA"
    | "TARGET_ROAS";
  targetCpaUsd?: number;
  targetRoas?: number;
};

export type LaunchInput = {
  brief: CreateBrief;
  channel: "SEARCH" | "PMAX";
  accountId: string;
  dailyBudgetUsd: number;
  audience: {
    country: CountryCode;
  };
  // SEARCH copy — Phase A5 multi-ad-group: each cluster becomes an
  // AdGroup on Google. Required when channel='SEARCH'.
  searchClusters?: ThemeCluster[];
  // PMAX copy — Phase A5 multi-asset-group: each cluster becomes an
  // AssetGroup on Google. Required when channel='PMAX'. Image assets
  // (logo + marketing) are shared across all asset groups.
  pmaxClusters?: PmaxAssetGroupCluster[];
  // Image asset IDs (optional — only matter for PMAX launch)
  assetIds?: GeneratedAssetIds;
  // A6: customer's conversion-tracking setup choices (LEGACY — kept for
  // backward compat. Phase B3 replaces this with the real
  // primaryConversionActionId picker below; the form sends both for
  // now so the audit log keeps useful context.)
  conversionTracking?: ConversionTrackingInput;
  // B3: the conversion action this campaign optimizes for. NULL is
  // allowed only when bidding strategy is MAXIMIZE_CLICKS (the form
  // enforces this client-side; the server falls back to safe defaults).
  primaryConversionActionId?: string;
  // A7: bidding strategy override (validated only if A6 declared
  // validated; UI enforces this).
  bidding?: BiddingStrategyInput;
};

export type LaunchResult =
  | { ok: true; campaignId: string }
  | { ok: false; error: string };

export async function launchCampaignFromCreate(
  input: LaunchInput,
): Promise<LaunchResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't launch." };
  }

  // Translate the autopilot draft → wizard CampaignDraft shape.
  // The wizard's `book` field is the legacy name for "subject of the
  // ad" — we map brand+description onto it. Rename TODO when we're
  // ready to deprecate the wizard fully.
  const draft = buildWizardDraft(input);

  // Re-validate on the server with the wizard's full schema. Never
  // trust the client.
  const parsed = FullDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${first.path.join(".")} — ${first.message}`
        : "Invalid draft.",
    };
  }
  const validated = parsed.data;

  // Tenant + ownership check on the chosen account.
  const account = await db.adsAccount.findFirst({
    where: {
      id: validated.accountId,
      userId: session.user.id,
      demoMode: false,
    },
    select: { id: true, customerId: true },
  });
  if (!account) {
    return { ok: false, error: "Account not found or not yours." };
  }

  // Build payload + YAML — exactly the same path the wizard uses.
  const yamlText = buildCampaignYaml(validated);
  const payload = buildLaunchPayload(validated);

  const isPmax = validated.channel === "PMAX";
  const dailyUsd = isPmax
    ? validated.pmaxBudget!.dailyUsd
    : validated.searchBudget!.dailyUsd;
  const biddingStrategy = isPmax
    ? validated.pmaxBudget!.biddingStrategy
    : validated.searchBudget!.biddingStrategy;

  // B3: validate the picked primary conversion action — must belong to
  // this account and be ENABLED. Silently drops invalid IDs (the form's
  // gate normally prevents that, but never trust the client).
  let primaryConversionActionId: string | null = null;
  if (input.primaryConversionActionId) {
    const action = await db.conversionAction.findFirst({
      where: {
        id: input.primaryConversionActionId,
        accountId: account.id,
        status: "ENABLED",
      },
      select: { id: true },
    });
    primaryConversionActionId = action?.id ?? null;
  }

  const campaign = await db.campaign.create({
    data: {
      accountId: account.id,
      name: validated.book.title.slice(0, 255),
      channelType: validated.channel,
      status: "PAUSED",
      dailyBudgetMicros: BigInt(Math.round(dailyUsd * 1_000_000)),
      biddingStrategy,
      yamlText,
      payloadJson: payload,
      source: "created",
      primaryConversionActionId,
      demoMode: false,
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "campaign.create_via_autopilot",
      targetKind: "campaign",
      targetId: campaign.id,
      payload: {
        channel: validated.channel,
        customerId: account.customerId,
        biddingStrategy,
        dailyUsd,
        // A6: legacy self-attestation snapshot (kept for audit context).
        conversionTracking: input.conversionTracking ?? null,
        // B3: actual ConversionAction FK persisted on the Campaign row.
        primaryConversionActionId,
      },
    },
  });

  revalidatePath("/app/campaigns");
  revalidatePath(`/app/accounts/${account.id}`);

  return { ok: true, campaignId: campaign.id };
}

/**
 * Build a wizard-shaped `CampaignDraft` from the autopilot's flat input.
 * Pre-fills defaults for fields the autopilot doesn't ask about (bidding
 * strategy, negative keywords, etc.) so the wizard's strict schema
 * accepts it.
 */
function buildWizardDraft(input: LaunchInput): CampaignDraft {
  const isPmax = input.channel === "PMAX";

  // Bidding strategy resolution (Phase A7):
  //   - If the user picked one in the UI (gated on conversion tracking
  //     being declared valid), use it.
  //   - Otherwise fall back to safe defaults: MAXIMIZE_CLICKS for SEARCH
  //     (works without conversion tracking) and MAXIMIZE_CONVERSIONS
  //     for PMAX (PMAX always needs conversion tracking — the launcher
  //     will refuse without it).
  const userBidding = input.bidding?.strategy;
  const searchBidding =
    userBidding === "MAXIMIZE_CLICKS" ||
    userBidding === "MAXIMIZE_CONVERSIONS" ||
    userBidding === "TARGET_CPA"
      ? userBidding
      : ("MAXIMIZE_CLICKS" as const);
  const pmaxBidding =
    userBidding === "MAXIMIZE_CONVERSIONS" ||
    userBidding === "MAXIMIZE_CONVERSION_VALUE" ||
    userBidding === "TARGET_CPA" ||
    userBidding === "TARGET_ROAS"
      ? userBidding
      : ("MAXIMIZE_CONVERSIONS" as const);

  return {
    channel: input.channel,
    accountId: input.accountId,
    book: {
      title: input.brief.brandName.slice(0, 255),
      description: input.brief.productDescription.slice(0, 2000),
      landingPageUrl: input.brief.landingPageUrl ?? "https://example.com",
      isbn: undefined,
    },
    audience: {
      country: input.audience.country,
      scope: "nationwide",
      cities: [],
    },
    // Legacy field — kept populated as a fallback for SEARCH only. The
    // adapter prefers `searchAdGroups` when present, so this is just
    // backward compat. We use the first cluster's copy as the placeholder.
    // For PMAX we leave it `undefined` — populating it with empty arrays
    // would trigger SearchAdCopySchema's `.min(3)` validation.
    searchAdCopy: !isPmax && input.searchClusters?.[0]
      ? {
          headlines: input.searchClusters[0].headlines,
          descriptions: input.searchClusters[0].descriptions,
          keywords: input.searchClusters[0].keywords,
          negativeKeywords: [],
        }
      : undefined,
    // Phase A5 — multi-ad-group SEARCH. When present, the adapter
    // creates one AdGroup per cluster.
    searchAdGroups:
      !isPmax && input.searchClusters && input.searchClusters.length > 0
        ? input.searchClusters.map((c) => ({
            themeLabel: c.themeLabel,
            intent: c.intent,
            headlines: c.headlines,
            descriptions: c.descriptions,
            keywords: c.keywords,
            negativeKeywords: [],
          }))
        : undefined,
    // Legacy single-asset-group `pmaxAdCopy` — kept populated as a
    // fallback for PMAX only. The adapter prefers `pmaxAssetGroups`
    // when present; we use the first cluster's copy as the placeholder.
    // For SEARCH we leave it `undefined` — populating with empty arrays
    // would trigger PmaxAdCopySchema's `.min(3)` validation.
    pmaxAdCopy: isPmax && input.pmaxClusters?.[0]
      ? {
          headlines: input.pmaxClusters[0].headlines,
          longHeadlines: input.pmaxClusters[0].longHeadlines,
          descriptions: input.pmaxClusters[0].descriptions,
          businessName: input.pmaxClusters[0].businessName,
        }
      : undefined,
    // Phase A5 — multi-asset-group PMAX. When present, the adapter
    // creates one AssetGroup per cluster.
    pmaxAssetGroups:
      isPmax && input.pmaxClusters && input.pmaxClusters.length > 0
        ? input.pmaxClusters.map((c) => ({
            themeLabel: c.themeLabel,
            intent: c.intent,
            headlines: c.headlines,
            longHeadlines: c.longHeadlines,
            descriptions: c.descriptions,
            businessName: c.businessName,
          }))
        : undefined,
    searchBudget: {
      dailyUsd: input.dailyBudgetUsd,
      biddingStrategy: searchBidding,
      maxCpcUsd: undefined,
      targetCpaUsd:
        searchBidding === "TARGET_CPA"
          ? input.bidding?.targetCpaUsd
          : undefined,
    },
    pmaxBudget: {
      dailyUsd: input.dailyBudgetUsd,
      biddingStrategy: pmaxBidding,
      targetCpaUsd:
        pmaxBidding === "TARGET_CPA"
          ? input.bidding?.targetCpaUsd
          : undefined,
      targetRoas:
        pmaxBidding === "TARGET_ROAS"
          ? input.bidding?.targetRoas
          : undefined,
    },
    pmaxAssets: {
      logoAssetId: input.assetIds?.logoAssetId,
      landscapeLogoAssetId: input.assetIds?.landscapeLogoAssetId,
      marketingImageAssetId: input.assetIds?.marketingImageAssetId,
      squareMarketingImageAssetId: input.assetIds?.squareMarketingImageAssetId,
      portraitMarketingImageAssetId: input.assetIds?.portraitMarketingImageAssetId,
    },
  };
}

