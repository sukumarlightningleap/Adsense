"use server";

/**
 * Save a new campaign from the wizard.
 *
 *   1. Server-side re-validate the full draft (the client wizard also
 *      validates per-step, but never trust the client).
 *   2. Confirm the chosen account is in scope for this user (no
 *      cross-tenant writes).
 *   3. Build the YAML payload.
 *   4. Insert as PAUSED with channel SEARCH (Phase 4 takes it from here).
 *   5. Audit-log + redirect to the new detail page.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
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
