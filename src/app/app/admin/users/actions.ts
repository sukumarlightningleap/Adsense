"use server";

/**
 * Admin actions for managing users.
 *
 *   - createUserAction:        admin only. Inserts a new user (member / demo
 *                              / admin) with a bcrypted password. Idempotent
 *                              email check before insert.
 *   - toggleUserActiveAction:  admin only. Flips `isActive` for any user
 *                              except the caller (no self-lockout).
 *
 * Both write to the audit log. Both revalidate /app/admin/users so the
 * server-rendered list refreshes after the action completes.
 */
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { UserRole } from "@/lib/auth/roles";

export type CreateUserState = {
  error: string | null;
  success: string | null;
};

const CreateUserSchema = z.object({
  email: z
    .string()
    .email("Enter a valid email")
    .transform((s) => s.trim().toLowerCase()),
  name: z.string().min(1, "Name is required").transform((s) => s.trim()),
  role: z.enum(["admin", "member", "demo"] as const),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

async function requireAdmin(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return { id: session.user.id };
}

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const caller = await requireAdmin();

  const parsed = CreateUserSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: first?.message ?? "Invalid input",
      success: null,
    };
  }

  const { email, name, role, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { error: `User ${email} already exists.`, success: null };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const created = await db.user.create({
    data: {
      email,
      name,
      hashedPassword,
      role: role as UserRole,
      isActive: true,
    },
  });

  await db.auditLog.create({
    data: {
      userId: caller.id,
      action: "user.create",
      targetKind: "user",
      targetId: created.id,
      payload: { email, role },
    },
  });

  revalidatePath("/app/admin/users");
  return {
    error: null,
    success: `Created ${role}: ${email}`,
  };
}

export async function toggleUserActiveAction(
  formData: FormData,
): Promise<void> {
  const caller = await requireAdmin();
  const targetId = String(formData.get("userId") ?? "");
  if (!targetId) return;
  // Defensive: don't let an admin lock themselves out.
  if (targetId === caller.id) return;

  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) return;

  await db.user.update({
    where: { id: targetId },
    data: { isActive: !target.isActive },
  });

  await db.auditLog.create({
    data: {
      userId: caller.id,
      action: target.isActive ? "user.deactivate" : "user.activate",
      targetKind: "user",
      targetId,
    },
  });

  revalidatePath("/app/admin/users");
}
