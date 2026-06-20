/**
 * Notification emitter — write a notification to the queue.
 *
 * Anything that wants to tell a customer something (auto-pause
 * action, tracking break, low wallet, weekly report) calls
 * `emitNotification(...)`. The deliverer cron picks up
 * `status='pending'` rows and sends them via Resend.
 *
 * The notification is ALSO visible in the in-app inbox immediately —
 * delivery is just for out-of-app channels (email / SMS / WhatsApp).
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export type NotificationKind =
  | "auto_pause"
  | "pause_suggestion"
  | "tracking_break"
  | "import_error"
  | "import_success"
  | "launch_success"
  | "low_balance"
  | "weekly_report"
  | "system";

export type NotificationSeverity = "info" | "warning" | "error";

export async function emitNotification(input: {
  userId: string;
  accountId?: string | null;
  kind: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}): Promise<string> {
  const created = await db.notification.create({
    data: {
      userId: input.userId,
      accountId: input.accountId ?? null,
      kind: input.kind,
      severity: input.severity ?? "info",
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 2000),
      // Prisma's nullable Json field treats `undefined` as "don't set"
      // (column defaults to NULL). The cast is needed because our
      // `Record<string, unknown>` accepts `unknown` values, but
      // `Prisma.InputJsonValue` only accepts JSON-serializable values
      // — the runtime contract from the caller is the same.
      payload: input.payload as Prisma.InputJsonValue | undefined,
      status: "pending",
    },
    select: { id: true },
  });
  return created.id;
}
