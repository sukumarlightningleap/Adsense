"use server";

/**
 * Workspace-level server actions used across the /app shell.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { writeRawDemoCookie } from "@/lib/demo/cookie";
import { isAdmin } from "@/lib/auth/roles";

/**
 * Flip the demo-mode cookie. Admin-only — for member/demo users the
 * cookie is ignored anyway (their effective mode is forced by role), so
 * this is just defense-in-depth.
 *
 * `bind`-friendly signature: takes the target value, no FormData.
 */
export async function setDemoModeAction(targetValue: boolean): Promise<void> {
  const session = await auth();
  if (!isAdmin(session?.user?.role)) {
    return;
  }
  await writeRawDemoCookie(targetValue);
  // Revalidate the whole /app subtree so every page picks up the change.
  revalidatePath("/app", "layout");
}
