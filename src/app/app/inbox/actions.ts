"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";

/**
 * Mark one notification as read. Idempotent — re-marking a read
 * notification is a no-op.
 */
export async function markReadAction(notificationId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  await db.notification.updateMany({
    where: { id: notificationId, userId: session.user.id },
    data: { readAt: new Date() },
  });
  revalidatePath("/app/inbox");
}
