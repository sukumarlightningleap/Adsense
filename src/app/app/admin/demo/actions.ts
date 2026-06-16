"use server";

/**
 * Admin actions for the demo dataset.
 *
 *   - seedDemoAction:  admin only. Wipes existing demo rows, then seeds
 *                      a fresh org-wide dataset owned by the caller.
 *   - resetDemoAction: admin only. Wipes all demo rows (real data
 *                      untouched).
 *
 * Both actions revalidate /app/admin/demo so the stats card refreshes.
 * Both write an audit log entry.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { seedDemoData, wipeDemoData, type SeedSummary } from "@/lib/demo/seeder";

export type DemoActionState = {
  error: string | null;
  message: string | null;
};

async function requireAdmin(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return { id: session.user.id };
}

export async function seedDemoAction(
  _prev: DemoActionState,
  _formData: FormData,
): Promise<DemoActionState> {
  try {
    const caller = await requireAdmin();
    const summary: SeedSummary = await seedDemoData({
      ownerUserId: caller.id,
    });
    await db.auditLog.create({
      data: {
        userId: caller.id,
        action: "demo.seed",
        payload: { ...summary },
      },
    });
    revalidatePath("/app/admin/demo");
    return {
      error: null,
      message: `Seeded ${summary.accounts} accounts, ${summary.campaigns} campaigns, ${summary.dailyKpis.toLocaleString()} KPI rows, ${summary.assets} assets.`,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Seed failed",
      message: null,
    };
  }
}

export async function resetDemoAction(
  _prev: DemoActionState,
  _formData: FormData,
): Promise<DemoActionState> {
  try {
    const caller = await requireAdmin();
    const { demoAccountsDeleted } = await wipeDemoData();
    await db.auditLog.create({
      data: {
        userId: caller.id,
        action: "demo.reset",
        payload: { demoAccountsDeleted },
      },
    });
    revalidatePath("/app/admin/demo");
    return {
      error: null,
      message: `Wiped ${demoAccountsDeleted} demo account${demoAccountsDeleted === 1 ? "" : "s"} and everything attached.`,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Reset failed",
      message: null,
    };
  }
}
