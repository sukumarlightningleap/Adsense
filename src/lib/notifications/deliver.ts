/**
 * Notification deliverer — pulls `pending` rows from the queue and
 * sends them out-of-app (currently email via Resend; Twilio SMS +
 * WhatsApp are stubbed for Phase 11.1).
 *
 * Designed to be safe to re-run: each row's `status` flips to `sent`,
 * `failed`, or `skipped` so the next pass only picks up new work.
 *
 * If `RESEND_API_KEY` isn't configured, rows transition to `skipped`
 * — the notification still lives in the in-app inbox, just no email
 * was delivered. Lets dev work without paid email infrastructure.
 */
import { db } from "@/lib/db";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_BATCH = 50;

export type DeliveryResult = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export async function deliverPendingNotifications(): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || "Adsense <noreply@adsense.app>";

  const pending = await db.notification.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH,
    include: {
      user: { select: { email: true, name: true } },
    },
  });

  const out: DeliveryResult = {
    attempted: pending.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const n of pending) {
    if (!apiKey) {
      // Inbox-only mode — mark as skipped so we don't retry forever.
      await db.notification.update({
        where: { id: n.id },
        data: {
          status: "skipped",
          deliveredAt: new Date(),
          deliveryError: "RESEND_API_KEY not configured — inbox-only delivery",
        },
      });
      out.skipped += 1;
      continue;
    }
    if (!n.user.email) {
      await db.notification.update({
        where: { id: n.id },
        data: {
          status: "skipped",
          deliveredAt: new Date(),
          deliveryError: "User has no email",
        },
      });
      out.skipped += 1;
      continue;
    }

    try {
      const subject = `[${severityLabel(n.severity)}] ${n.title}`.slice(0, 200);
      const html = renderHtml({
        recipientName: n.user.name ?? n.user.email,
        title: n.title,
        body: n.body,
        kind: n.kind,
        severity: n.severity,
      });
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: n.user.email,
          subject,
          html,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `Resend HTTP ${res.status}: ${errText.slice(0, 200)}`,
        );
      }
      await db.notification.update({
        where: { id: n.id },
        data: { status: "sent", deliveredAt: new Date() },
      });
      out.sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.notification.update({
        where: { id: n.id },
        data: {
          status: "failed",
          deliveredAt: new Date(),
          deliveryError: msg.slice(0, 500),
        },
      });
      out.failed += 1;
      out.errors.push(`${n.id}: ${msg}`);
    }
  }

  return out;
}

function severityLabel(s: string): string {
  if (s === "error") return "URGENT";
  if (s === "warning") return "Action needed";
  return "Update";
}

function renderHtml(opts: {
  recipientName: string;
  title: string;
  body: string;
  kind: string;
  severity: string;
}): string {
  const banner =
    opts.severity === "error"
      ? "#dc2626"
      : opts.severity === "warning"
        ? "#d97706"
        : "#0f172a";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:${banner};color:white;padding:18px 24px;font-size:14px;font-weight:600">
      Adsense · ${escapeHtml(opts.kind.replace(/_/g, " "))}
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 8px;font-size:12px;color:#64748b">Hi ${escapeHtml(opts.recipientName)},</p>
      <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${escapeHtml(opts.title)}</h2>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap">${escapeHtml(opts.body)}</p>
      <p style="margin:24px 0 0;font-size:12px;color:#64748b">— Adsense Autopilot</p>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
