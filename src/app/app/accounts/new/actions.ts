"use server";

/**
 * Server action for connecting a new Google Ads account.
 *
 * Phase 2 scope: form validation, uniqueness check, DB insert, audit log.
 *
 * Phase 3 will add: SDK call to `list_accessible_customers` so we verify
 * the account is actually reachable before saving. For now, format
 * validation only — credentials live in env vars (GOOGLE_ADS_*) and
 * verification happens at first campaign launch.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/lib/db";

export type ConnectAccountState = {
  error: string | null;
};

// Customer IDs are 10 digits; users often paste with dashes (XXX-XXX-XXXX) —
// we strip those before storing.
const customerIdSchema = z
  .string()
  .transform((s) => s.replace(/[-\s]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\d{10}$/, "Customer ID must be 10 digits (with or without dashes)"),
  );

const optionalCustomerId = z
  .string()
  .optional()
  .transform((s) => (s ? s.replace(/[-\s]/g, "") : ""))
  .pipe(
    z
      .string()
      .regex(
        /^(\d{10})?$/,
        "Login customer ID must be 10 digits (or empty)",
      ),
  );

const ConnectSchema = z.object({
  customerId: customerIdSchema,
  descriptiveName: z
    .string()
    .max(255)
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : null)),
  loginCustomerId: optionalCustomerId.transform((s) => (s === "" ? null : s)),
  currencyCode: z
    .string()
    .max(8)
    .optional()
    .transform((s) => (s?.trim() ? s.trim().toUpperCase() : "USD")),
  timeZone: z
    .string()
    .max(64)
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : "America/New_York")),
});

export async function connectAccountAction(
  _prev: ConnectAccountState,
  formData: FormData,
): Promise<ConnectAccountState> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in." };
  }
  if (session.user.role === "demo") {
    return { error: "Demo users cannot connect live accounts." };
  }

  const parsed = ConnectSchema.safeParse({
    customerId: formData.get("customerId"),
    descriptiveName: formData.get("descriptiveName") ?? undefined,
    loginCustomerId: formData.get("loginCustomerId") ?? undefined,
    currencyCode: formData.get("currencyCode") ?? undefined,
    timeZone: formData.get("timeZone") ?? undefined,
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const data = parsed.data;

  // Uniqueness: same (userId, provider, customerId) can't repeat for this
  // user. The unique constraint catches it too, but a friendlier message
  // here.
  const existing = await db.adsAccount.findFirst({
    where: {
      userId: session.user.id,
      provider: "google_ads",
      customerId: data.customerId,
    },
    select: { id: true },
  });
  if (existing) {
    return {
      error: `You've already connected customer ID ${data.customerId}.`,
    };
  }

  const created = await db.adsAccount.create({
    data: {
      userId: session.user.id,
      provider: "google_ads",
      customerId: data.customerId,
      descriptiveName: data.descriptiveName,
      loginCustomerId: data.loginCustomerId,
      currencyCode: data.currencyCode,
      timeZone: data.timeZone,
      demoMode: false,
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "account.connect",
      targetKind: "ads_account",
      targetId: created.id,
      payload: {
        customerId: data.customerId,
        descriptiveName: data.descriptiveName,
      },
    },
  });

  revalidatePath("/app/accounts");
  revalidatePath("/app");
  // Land them on the new account's detail page.
  redirect(`/app/accounts/${created.id}`);
}
