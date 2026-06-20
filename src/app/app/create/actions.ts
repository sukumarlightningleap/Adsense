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
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { planCampaign, type CampaignPlan } from "@/lib/ai/architect";
import { GeminiKeyError } from "@/lib/ai/gemini-client";
import {
  generateAssetsForBrief,
  generateCopyForBrief,
  type GeneratedAssetIds,
  type GeneratedCopy,
  type PipelineMode,
} from "@/lib/ai/pipeline";
import type { AdBrief } from "@/lib/ai/types";
import { buildLaunchPayload } from "@/lib/wizard/payload-builder";
import {
  FullDraftSchema,
  type CampaignDraft,
  type CountryCode,
} from "@/lib/wizard/schema";
import { buildCampaignYaml } from "@/lib/wizard/yaml-builder";

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

export type PlanAndGenerateResult =
  | {
      ok: true;
      plan: PlanSummary;
      copy: GeneratedCopy;
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

  const brief: AdBrief = {
    channel: input.channel ?? "SEARCH",
    brandName,
    productDescription,
    landingPageUrl: input.landingPageUrl?.trim() ?? "",
  };

  try {
    // Run architect + copy in parallel. The architect doesn't depend on
    // the copy and vice versa.
    const [plan, copy] = await Promise.all([
      planCampaign(brief),
      generateCopyForBrief(brief),
    ]);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ai.create_campaign_plan",
        targetKind: "campaign",
        targetId: null,
        payload: {
          brandName,
          channel: brief.channel,
          sector: plan.sector,
          packId: plan.pack.id,
          headlineCount: copy.copy.headlines.length,
        },
      },
    });

    return {
      ok: true,
      plan: summarizePlan(plan),
      copy,
      brief,
    };
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
  | { ok: true; copy: GeneratedCopy }
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

  try {
    const copy = await generateCopyForBrief({
      channel: input.channel ?? "SEARCH",
      brandName,
      productDescription,
      landingPageUrl: input.landingPageUrl?.trim() ?? "",
    });
    return { ok: true, copy };
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
  // SEARCH copy
  search?: {
    headlines: string[];
    descriptions: string[];
    keywords: string[];
  };
  // PMAX copy
  pmax?: {
    headlines: string[];
    longHeadlines: string[];
    descriptions: string[];
    businessName: string;
  };
  // Image asset IDs (optional — only matter for PMAX launch)
  assetIds?: GeneratedAssetIds;
  // A6: customer's conversion-tracking setup choices
  conversionTracking?: ConversionTrackingInput;
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
        // A6: customer's stated conversion-tracking setup. None of
        // this is enforced server-side yet — it's a record of what
        // they said so Phase 8c (real tag / GTM / CRM provisioning)
        // can pick it up.
        conversionTracking: input.conversionTracking ?? null,
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
    searchAdCopy: !isPmax && input.search
      ? {
          headlines: input.search.headlines,
          descriptions: input.search.descriptions,
          keywords: input.search.keywords,
          negativeKeywords: [],
        }
      : { headlines: [], descriptions: [], keywords: [], negativeKeywords: [] },
    pmaxAdCopy: isPmax && input.pmax
      ? {
          headlines: input.pmax.headlines,
          longHeadlines: input.pmax.longHeadlines,
          descriptions: input.pmax.descriptions,
          businessName: input.pmax.businessName,
        }
      : {
          headlines: [],
          longHeadlines: [],
          descriptions: [],
          businessName: "",
        },
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

