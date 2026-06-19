"use server";

/**
 * Server actions for the campaign detail page controls.
 *
 *   - `setCampaignStatusAction` — Pause / Enable / Remove a campaign,
 *     writing to Google Ads + mirroring our DB.
 *   - `refreshCampaignAction` — pull the campaign's current name + status
 *     from Google and update our DB row.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  refreshCampaignFromGoogle,
  setCampaignStatus,
  type RefreshResult,
  type SetStatusResult,
} from "@/lib/google-ads/mutations";

export async function setCampaignStatusAction(
  campaignId: string,
  newStatus: "ENABLED" | "PAUSED" | "REMOVED",
): Promise<SetStatusResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't mutate campaigns." };
  }
  const res = await setCampaignStatus({
    campaignId,
    userId: session.user.id,
    newStatus,
  });
  if (res.ok) {
    revalidatePath(`/app/campaigns/${campaignId}`);
    revalidatePath("/app/campaigns");
  }
  return res;
}

export async function refreshCampaignAction(
  campaignId: string,
): Promise<RefreshResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't refresh." };
  }
  const res = await refreshCampaignFromGoogle({
    campaignId,
    userId: session.user.id,
  });
  if (res.ok) {
    revalidatePath(`/app/campaigns/${campaignId}`);
    revalidatePath("/app/campaigns");
  }
  return res;
}
