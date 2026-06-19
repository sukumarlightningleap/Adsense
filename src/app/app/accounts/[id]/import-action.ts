"use server";

/**
 * Server action that runs the adoption importer for an AdsAccount.
 *
 * Triggered from the "Import now" button on the account detail page.
 * Synchronous for v1 — typical accounts import in <30s. If we hit
 * accounts that take longer than the Vercel server-action ceiling
 * (60s), we'll move this to a background job + status row.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { importAccountData, type ImportResult } from "@/lib/google-ads/importer";

export type RunImportResult =
  | { ok: true; result: ImportResult }
  | { ok: false; error: string };

export async function runImportAction(
  accountId: string,
): Promise<RunImportResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't import." };
  }
  if (!accountId) return { ok: false, error: "Missing accountId." };

  try {
    const result = await importAccountData({
      accountId,
      userId: session.user.id,
    });
    revalidatePath(`/app/accounts/${accountId}`);
    revalidatePath("/app/accounts");
    revalidatePath("/app/campaigns");
    return { ok: true, result };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Import failed.",
    };
  }
}
