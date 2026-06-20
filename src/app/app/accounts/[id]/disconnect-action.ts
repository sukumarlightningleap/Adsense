"use server";

/**
 * Disconnect a Google Ads account from Adsense.
 *
 * Clears the stored OAuth credentials + connection metadata. Does NOT
 * delete imported campaigns / ad groups / keywords — they stay for
 * historical reference + we can re-attach a new OAuth token later if
 * the user reconnects.
 *
 * Phase 11.1 will add an option to ALSO revoke the token at Google
 * via the standard https://oauth2.googleapis.com/revoke endpoint.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";

export type DisconnectResult =
  | { ok: true }
  | { ok: false; error: string };

export async function disconnectAccountAction(
  accountId: string,
): Promise<DisconnectResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't disconnect." };
  }

  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true, customerId: true, oauthRefreshToken: true },
  });
  if (!account) return { ok: false, error: "Account not found." };

  await db.adsAccount.update({
    where: { id: account.id },
    data: {
      oauthRefreshToken: null,
      oauthScope: null,
      connectionStatus: "disabled",
      connectedAt: null,
      // Switch optimizer to 'off' so the cron stops touching it.
      optimizationMode: "off",
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ads_account.disconnect",
      targetKind: "ads_account",
      targetId: account.id,
      payload: {
        customerId: account.customerId,
        hadOauthToken: !!account.oauthRefreshToken,
      },
    },
  });

  revalidatePath(`/app/accounts/${account.id}`);
  revalidatePath("/app/accounts");
  return { ok: true };
}
