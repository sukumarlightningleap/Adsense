/**
 * /app/inbox — notification feed.
 *
 * Surfaces everything the autopilot has done on the customer's behalf
 * (auto-pauses, suggestions, tracking breaks, import failures). Each
 * row deep-links to the relevant account / campaign / ad group when
 * the payload carries the relevant id.
 *
 * Mark-as-read is purely a UX state — delivery (email/SMS) happens via
 * the deliverer cron and is separate.
 */
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Inbox as InboxIcon,
  Info,
  XCircle,
} from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

import { markReadAction } from "./actions";

export const metadata = { title: "Inbox · Adsense" };

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user) return null;

  const notifications = await db.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unreadCount = notifications.filter((n) => n.readAt == null).length;

  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
          <Bell className="size-3" />
          Inbox
        </div>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Autopilot updates
        </h1>
        <p className="mt-3 text-pretty text-[14px] leading-7 text-muted-foreground">
          Every action the optimizer takes on your behalf — auto-pauses,
          suggestions, tracking breaks, import results — surfaces here.
          {unreadCount > 0 && (
            <>
              {" "}
              <span className="font-medium text-foreground">
                {unreadCount} unread.
              </span>
            </>
          )}
        </p>
      </header>

      {notifications.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
          <div className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
            <InboxIcon className="size-5" />
          </div>
          <h2 className="mt-6 text-xl font-semibold tracking-[-0.02em]">
            No notifications yet
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[13.5px] leading-6 text-muted-foreground">
            Once your daily sync starts catching bleeders or tracking
            breaks, you&apos;ll see them here.
          </p>
        </div>
      ) : (
        <ul className="mt-10 space-y-2">
          {notifications.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  n,
}: {
  n: {
    id: string;
    accountId: string | null;
    kind: string;
    severity: string;
    title: string;
    body: string;
    payload: unknown;
    status: string;
    readAt: Date | null;
    createdAt: Date;
  };
}) {
  const isUnread = n.readAt == null;
  const Icon =
    n.severity === "error"
      ? XCircle
      : n.severity === "warning"
        ? AlertTriangle
        : n.kind === "import_success" || n.kind === "launch_success"
          ? CheckCircle2
          : Info;
  const sev =
    n.severity === "error"
      ? "bg-destructive/15 text-destructive"
      : n.severity === "warning"
        ? "bg-amber-500/15 text-amber-700"
        : "bg-foreground/5 text-foreground";

  const payload = (n.payload as { adGroupId?: string; campaignId?: string } | null) ?? {};
  const deepLink = payload.campaignId
    ? `/app/campaigns/${payload.campaignId}`
    : n.accountId
      ? `/app/accounts/${n.accountId}`
      : null;

  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        isUnread ? "border-foreground/20" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", sev)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13.5px] font-semibold">{n.title}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {n.kind.replace(/_/g, " ")}
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {n.createdAt.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {n.status === "sent" && (
              <span className="font-mono text-[10px] text-emerald-700">
                · emailed
              </span>
            )}
            {n.status === "failed" && (
              <span className="font-mono text-[10px] text-destructive">
                · email failed
              </span>
            )}
            {n.status === "skipped" && (
              <span className="font-mono text-[10px] text-muted-foreground">
                · inbox only
              </span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-muted-foreground">
            {n.body}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {deepLink && (
              <Link
                href={deepLink}
                className="text-[11.5px] font-medium text-foreground underline-offset-2 hover:underline"
              >
                Open →
              </Link>
            )}
            {isUnread && (
              <form action={markReadAction.bind(null, n.id)}>
                <button
                  type="submit"
                  className="text-[11.5px] text-muted-foreground hover:text-foreground"
                >
                  Mark as read
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
