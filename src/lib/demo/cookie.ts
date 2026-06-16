/**
 * Demo-mode cookie.
 *
 * The cookie stores the admin's RAW preference (true/false). The
 * *effective* mode applies role rules from `auth/roles.ts`:
 *
 *   - admin:  cookie value (their toggle wins)
 *   - member: always false (cookie ignored, toggle hidden in UI)
 *   - demo:   always true  (cookie ignored, toggle hidden in UI)
 *
 * Cookie is HTTPONLY — only readable on the server. We re-render via
 * server actions + revalidatePath instead of client-side reads, so the
 * UI stays in sync without exposing the value to JS.
 */
import { cookies } from "next/headers";

import {
  effectiveDemoMode,
  type UserRole,
} from "@/lib/auth/roles";

const COOKIE_NAME = "adsense-demo-mode";

export async function readRawDemoCookie(): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value === "true";
}

export async function writeRawDemoCookie(value: boolean): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, value ? "true" : "false", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });
}

/**
 * Resolve the *effective* demo mode for a user — what every DB query
 * should actually filter on.
 */
export async function getEffectiveDemoMode(
  role: UserRole | null | undefined,
): Promise<boolean> {
  const raw = await readRawDemoCookie();
  return effectiveDemoMode(role, raw);
}
