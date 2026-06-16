"use server";

/**
 * Self-service settings actions for the signed-in user.
 *
 *   - updateProfileAction:  change display name.
 *   - changePasswordAction: change password (verify current → set new).
 *
 * Both write an audit log entry. Note: the session JWT is cached in the
 * client cookie, so a name change here won't update the sidebar's name
 * until the user signs out and back in. We surface that in the UI.
 */
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/lib/db";

export type SettingsState = {
  error: string | null;
  success: string | null;
};

const NameSchema = z
  .string()
  .min(1, "Name is required")
  .max(255)
  .transform((s) => s.trim());

const PasswordSchema = z.string().min(8, "Password must be at least 8 characters");

async function requireAuth(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Sign-in required");
  }
  return { id: session.user.id };
}

export async function updateProfileAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    const me = await requireAuth();
    const parsed = NameSchema.safeParse(formData.get("name"));
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid name",
        success: null,
      };
    }
    await db.user.update({
      where: { id: me.id },
      data: { name: parsed.data },
    });
    await db.auditLog.create({
      data: {
        userId: me.id,
        action: "user.profile_update",
        targetKind: "user",
        targetId: me.id,
      },
    });
    revalidatePath("/app/settings");
    return {
      error: null,
      success: "Profile updated. Sign out and back in to refresh the sidebar.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Update failed",
      success: null,
    };
  }
}

export async function changePasswordAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    const me = await requireAuth();
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!currentPassword) {
      return { error: "Current password is required.", success: null };
    }
    const parsedNew = PasswordSchema.safeParse(newPassword);
    if (!parsedNew.success) {
      return {
        error: parsedNew.error.issues[0]?.message ?? "Invalid password",
        success: null,
      };
    }
    if (newPassword !== confirmPassword) {
      return { error: "New passwords don't match.", success: null };
    }
    if (newPassword === currentPassword) {
      return {
        error: "New password must be different from current.",
        success: null,
      };
    }

    const user = await db.user.findUnique({ where: { id: me.id } });
    if (!user) return { error: "Account not found.", success: null };

    const ok = await bcrypt.compare(currentPassword, user.hashedPassword);
    if (!ok) {
      return { error: "Current password is incorrect.", success: null };
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.user.update({
      where: { id: me.id },
      data: { hashedPassword: hashed },
    });
    await db.auditLog.create({
      data: {
        userId: me.id,
        action: "user.password_change",
        targetKind: "user",
        targetId: me.id,
      },
    });

    return { error: null, success: "Password updated." };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Update failed",
      success: null,
    };
  }
}
