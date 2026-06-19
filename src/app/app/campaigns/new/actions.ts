"use server";

/**
 * Wizard server actions.
 *
 *   - saveCampaignAction      : validate draft → insert PAUSED campaign.
 *   - generateCopyAction      : AI-fill the ad copy step from the brief.
 *   - generateAssetsAction    : AI-generate + resize + persist PMAX assets.
 *
 * The AI actions trust the *brief inputs* (book title / description /
 * landing page from step 1) and never trust the channel-specific copy or
 * asset fields the user is about to overwrite.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  generateAssetsForBrief,
  generateCopyForBrief,
  type GeneratedAssetIds,
  type PipelineMode,
} from "@/lib/ai/pipeline";
import {
  briefFromDraft,
  type GeneratedPmaxCopy,
  type GeneratedSearchCopy,
} from "@/lib/ai/types";
import { GeminiKeyError } from "@/lib/ai/gemini-client";
import { FullDraftSchema, type CampaignDraft } from "@/lib/wizard/schema";
import { buildLaunchPayload } from "@/lib/wizard/payload-builder";
import { buildCampaignYaml } from "@/lib/wizard/yaml-builder";

export type SaveCampaignResult =
  | { ok: true; campaignId: string }
  | { ok: false; error: string };

export async function saveCampaignAction(
  draft: CampaignDraft,
): Promise<SaveCampaignResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Sign-in required." };
  }
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't create campaigns." };
  }

  const parsed = FullDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")} — ${first.message}` : "Invalid",
    };
  }
  const validated = parsed.data;

  // Confirm the account belongs to this user (live only — demo accounts
  // aren't writeable through the wizard).
  const account = await db.adsAccount.findFirst({
    where: {
      id: validated.accountId,
      userId: session.user.id,
      demoMode: false,
    },
    select: { id: true, customerId: true },
  });
  if (!account) {
    return {
      ok: false,
      error: "Account not found or you don't have access to it.",
    };
  }

  const yamlText = buildCampaignYaml(validated);
  const payload = buildLaunchPayload(validated);

  // Channel-aware: pull budget + strategy from the right per-channel slice.
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
      demoMode: false,
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "campaign.draft_create",
      targetKind: "campaign",
      targetId: campaign.id,
      payload: {
        channel: validated.channel,
        customerId: account.customerId,
        biddingStrategy,
        dailyUsd,
        headlineCount: isPmax
          ? validated.pmaxAdCopy!.headlines.length
          : validated.searchAdCopy!.headlines.length,
        ...(isPmax
          ? {
              longHeadlineCount: validated.pmaxAdCopy!.longHeadlines.length,
              businessName: validated.pmaxAdCopy!.businessName,
            }
          : {
              keywordCount: validated.searchAdCopy!.keywords.length,
            }),
      },
    },
  });

  revalidatePath("/app/campaigns");
  revalidatePath(`/app/accounts/${account.id}`);
  // Redirect to the new campaign's detail page.
  redirect(`/app/campaigns/${campaign.id}`);
}

// ---------------------------------------------------------------------------
// AI content generation
// ---------------------------------------------------------------------------

export type GenerateCopyResult =
  | { ok: true; channel: "SEARCH"; copy: GeneratedSearchCopy }
  | { ok: true; channel: "PMAX"; copy: GeneratedPmaxCopy }
  | { ok: false; error: string };

/**
 * Fill the ad-copy step from the brief (book title + description from
 * step 1, country from step 2, plus seed keywords if the user already
 * typed some). The client is expected to splat the result into the
 * matching channel slice (`searchAdCopy` or `pmaxAdCopy`).
 */
export async function generateCopyAction(
  draft: CampaignDraft,
): Promise<GenerateCopyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't generate AI content." };
  }

  const brief = briefFromDraft(draft);
  if (!brief.brandName.trim() || !brief.productDescription.trim()) {
    return {
      ok: false,
      error:
        "Fill in the title and description on step 1 before generating copy.",
    };
  }

  try {
    const result = await generateCopyForBrief(brief);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ai.copy_generate",
        targetKind: "campaign",
        targetId: null,
        payload: {
          channel: result.channel,
          brandName: brief.brandName,
          headlineCount: result.copy.headlines.length,
        },
      },
    });

    if (result.channel === "PMAX") {
      return { ok: true, channel: "PMAX", copy: result.copy };
    }
    return { ok: true, channel: "SEARCH", copy: result.copy };
  } catch (e) {
    if (e instanceof GeminiKeyError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "AI generation failed.",
    };
  }
}

export type GenerateAssetsResult =
  | { ok: true; ids: GeneratedAssetIds }
  | { ok: false; error: string };

/**
 * Generate PMAX images via the AI pipeline (router picks fast vs
 * refined), push them through the sharp resize pipeline, and persist as
 * Asset rows tied to the chosen ads account. Returns per-role IDs ready
 * to splat into `draft.pmaxAssets`.
 *
 *   - "fast"    = 2 Gemini image calls (master + logo), ~10s, ~$0.08
 *   - "refined" = 5 Gemini image calls (Whisk-style: subject + scene +
 *                 style → fusion + logo), ~25s, ~$0.20, more on-brief
 */
export async function generateAssetsAction(
  draft: CampaignDraft,
  mode: PipelineMode = "fast",
): Promise<GenerateAssetsResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't generate AI assets." };
  }

  if (draft.channel !== "PMAX") {
    return {
      ok: false,
      error: "AI image generation is currently PMAX-only.",
    };
  }

  const brief = briefFromDraft(draft);
  if (!brief.brandName.trim() || !brief.productDescription.trim()) {
    return {
      ok: false,
      error:
        "Fill in the title and description on step 1 before generating images.",
    };
  }

  // Confirm the chosen account belongs to this user before tagging assets
  // with its id. We tolerate a missing accountId (asset still created,
  // just untagged) — the wizard step 1 has its own validation gate.
  let accountId: string | null = null;
  if (draft.accountId) {
    const account = await db.adsAccount.findFirst({
      where: {
        id: draft.accountId,
        userId: session.user.id,
        demoMode: false,
      },
      select: { id: true },
    });
    accountId = account?.id ?? null;
  }

  try {
    const ids = await generateAssetsForBrief(brief, {
      userId: session.user.id,
      accountId,
      mode,
    });
    revalidatePath("/app/assets");
    return { ok: true, ids };
  } catch (e) {
    if (e instanceof GeminiKeyError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "AI image generation failed.",
    };
  }
}
