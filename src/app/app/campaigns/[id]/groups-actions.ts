"use server";

/**
 * Server actions for per-ad-group + per-asset-group controls on the
 * campaign detail page. Thin wrappers around the mutation helpers in
 * `lib/google-ads/mutations.ts`.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  setAdGroupStatus,
  setAssetGroupStatus,
  type SetStatusResult,
} from "@/lib/google-ads/mutations";

export async function setAdGroupStatusAction(
  adGroupId: string,
  campaignId: string,
  newStatus: "ENABLED" | "PAUSED" | "REMOVED",
): Promise<SetStatusResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't mutate ad groups." };
  }
  const res = await setAdGroupStatus({
    adGroupId,
    userId: session.user.id,
    newStatus,
  });
  if (res.ok) revalidatePath(`/app/campaigns/${campaignId}`);
  return res;
}

export async function setAssetGroupStatusAction(
  assetGroupId: string,
  campaignId: string,
  newStatus: "ENABLED" | "PAUSED" | "REMOVED",
): Promise<SetStatusResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't mutate asset groups." };
  }
  const res = await setAssetGroupStatus({
    assetGroupId,
    userId: session.user.id,
    newStatus,
  });
  if (res.ok) revalidatePath(`/app/campaigns/${campaignId}`);
  return res;
}
