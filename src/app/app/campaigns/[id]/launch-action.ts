"use server";

/**
 * Launch a draft campaign to Google Ads.
 *
 * Flow:
 *   1. Auth + role check (no demo, no member acting on another user)
 *   2. Load campaign + account from DB (with scoping)
 *   3. Run preflight (deterministic checks, no SDK calls)
 *   4. Execute launch (SDK)
 *   5. On success: update campaign row with providerCampaignId + status
 *      tracking + audit log
 *   6. On failure: audit log the attempt, return typed error
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  executeLaunch,
  preflight,
  type LauncherOutcome,
} from "@/lib/google-ads/launcher";

export type LaunchActionResult =
  | { ok: true; profile: "test" | "prod"; providerCampaignId: string; resourceName: string }
  | { ok: false; code: string; message: string };

export async function launchCampaignAction(
  campaignId: string,
  confirm: boolean,
): Promise<LaunchActionResult> {
  if (!confirm) {
    return {
      ok: false,
      code: "CONFIRM_REQUIRED",
      message: "Confirmation checkbox is required to launch.",
    };
  }

  const session = await auth();
  if (!session?.user) {
    return { ok: false, code: "AUTH", message: "Sign-in required." };
  }
  if (session.user.role === "demo") {
    return {
      ok: false,
      code: "ROLE",
      message: "Demo users cannot launch campaigns.",
    };
  }

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { account: true },
  });
  if (!campaign) {
    return { ok: false, code: "NOT_FOUND", message: "Campaign not found." };
  }

  // Live mode only — the user must own the account.
  if (
    campaign.account.demoMode ||
    campaign.account.userId !== session.user.id
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "You don't own this account, or it's a demo account.",
    };
  }

  const pre = preflight({
    campaign: {
      id: campaign.id,
      status: campaign.status,
      channelType: campaign.channelType,
      demoMode: campaign.demoMode,
      dailyBudgetMicros: campaign.dailyBudgetMicros,
      payloadJson: campaign.payloadJson,
    },
    account: {
      customerId: campaign.account.customerId,
      loginCustomerId: campaign.account.loginCustomerId,
      demoMode: campaign.account.demoMode,
    },
  });
  if (!pre.ok) {
    return {
      ok: false,
      code: pre.error.code,
      message: pre.error.message,
    };
  }

  const outcome: LauncherOutcome = await executeLaunch(pre.ctx);

  if (!outcome.ok) {
    // Record the failure for traceability.
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "campaign.launch_failed",
        targetKind: "campaign",
        targetId: campaign.id,
        payload: {
          code: outcome.code,
          message: outcome.message.slice(0, 1000),
          customerId: campaign.account.customerId,
        },
      },
    });
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  // Success — persist provider IDs and mark the campaign launched.
  await db.campaign.update({
    where: { id: campaign.id },
    data: {
      providerCampaignId: outcome.result.providerCampaignId,
      // Stay PAUSED in our DB too — operator flips it from Google's UI.
      status: "PAUSED",
      launchedProfile: outcome.profile,
      launchedAt: new Date(),
    },
  });

  // Round-trip through JSON.stringify so the `OperationSummary[]` widens
  // to a plain JSON value Prisma accepts (its `InputJsonValue` rejects
  // typed arrays of objects without an index signature).
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "campaign.launched",
      targetKind: "campaign",
      targetId: campaign.id,
      payload: JSON.parse(
        JSON.stringify({
          profile: outcome.profile,
          providerCampaignId: outcome.result.providerCampaignId,
          resourceName: outcome.result.resourceName,
          customerId: campaign.account.customerId,
          operations: outcome.result.operations,
        }),
      ),
    },
  });

  revalidatePath(`/app/campaigns/${campaign.id}`);
  revalidatePath(`/app/campaigns`);
  revalidatePath(`/app/accounts/${campaign.accountId}`);

  return {
    ok: true,
    profile: outcome.profile,
    providerCampaignId: outcome.result.providerCampaignId,
    resourceName: outcome.result.resourceName,
  };
}
