/**
 * Conversion-tracking health transitions — Phase B7.
 *
 * Runs after the daily sync's conversion-action update pass. For each
 * ConversionAction, compares the PRIOR health snapshot (the
 * `recentConversions` + `lastConversionAt` we had BEFORE this sync's
 * update) against the NEW snapshot. When the health bucket flips in a
 * way the customer cares about, we emit a notification:
 *
 *   working → stale     → "warning" notification ("tag may be degrading")
 *   working → broken    → "error" notification ("tag is broken — fix now")
 *   stale → broken      → "error" notification (escalation)
 *   broken → working    → "info" notification ("tag is firing again")
 *   stale → working     → "info" notification (recovery)
 *
 * Reuses Phase 11's `emitNotification` so delivery happens via the
 * existing `/api/cron/deliver-notifications` cron + Resend transport.
 *
 * Idempotence: this pass runs once per account per sync invocation
 * (which is once per day per account by default). We don't double-emit
 * within the same sync run because we snapshot health BEFORE updating
 * the rows and re-read the updated rows AFTER.
 */
import { db } from "@/lib/db";

import { emitNotification } from "@/lib/notifications/emit";

import {
  getConversionHealthForAccount,
  type ConversionHealthStatus,
} from "./health";

export type HealthSnapshot = Map<string, ConversionHealthStatus>;

/**
 * Snapshot the current health per conversion action for an account.
 * Call BEFORE running the sync's conversion-action update pass — the
 * returned map is the "before" state that downstream transition
 * detection compares against.
 */
export async function snapshotConversionHealth(
  accountId: string,
): Promise<HealthSnapshot> {
  const rows = await getConversionHealthForAccount({ accountId });
  return new Map(rows.map((r) => [r.id, r.health]));
}

export type TransitionEmitResult = {
  emitted: number;
  transitions: Array<{
    conversionActionId: string;
    name: string;
    from: ConversionHealthStatus;
    to: ConversionHealthStatus;
    notificationId: string;
  }>;
};

/**
 * After the sync has updated conversion-action stats, compare with the
 * pre-sync `before` snapshot. Emit a notification for every transition
 * that crosses one of our care-about boundaries.
 */
export async function detectAndEmitHealthTransitions(opts: {
  accountId: string;
  before: HealthSnapshot;
}): Promise<TransitionEmitResult> {
  // Account → owner (we emit notifications to the owning user).
  const account = await db.adsAccount.findFirst({
    where: { id: opts.accountId },
    select: {
      id: true,
      userId: true,
      descriptiveName: true,
      customerId: true,
    },
  });
  if (!account) return { emitted: 0, transitions: [] };

  // Re-compute health AFTER the sync.
  const afterRows = await getConversionHealthForAccount({
    accountId: opts.accountId,
  });

  const out: TransitionEmitResult["transitions"] = [];
  for (const row of afterRows) {
    const before = opts.before.get(row.id);
    if (!before) continue; // newly imported action — no prior baseline
    const after = row.health;
    if (before === after) continue;

    const decided = decideTransition(before, after);
    if (!decided) continue;

    const accountLabel =
      account.descriptiveName ?? `Customer ${account.customerId}`;
    const notificationId = await emitNotification({
      userId: account.userId,
      accountId: account.id,
      kind: "tracking_break",
      severity: decided.severity,
      title: decided.title(row.name),
      body: decided.body({
        actionName: row.name,
        accountLabel,
        accountId: account.id,
        reason: row.reason,
        daysSinceLastFire: row.daysSinceLastFire,
      }),
      payload: {
        conversionActionId: row.id,
        accountId: account.id,
        from: before,
        to: after,
        reason: row.reason,
        daysSinceLastFire: row.daysSinceLastFire,
        recentConversions: row.recentConversions,
        providerConversionId: row.providerConversionId,
      },
    });
    out.push({
      conversionActionId: row.id,
      name: row.name,
      from: before,
      to: after,
      notificationId,
    });
  }

  return { emitted: out.length, transitions: out };
}

// ===========================================================================
// Transition policy — decides severity + copy per (from, to) tuple
// ===========================================================================

type TransitionCopy = {
  severity: "info" | "warning" | "error";
  title: (actionName: string) => string;
  body: (opts: {
    actionName: string;
    accountLabel: string;
    accountId: string;
    reason: string;
    daysSinceLastFire: number | null;
  }) => string;
};

function decideTransition(
  from: ConversionHealthStatus,
  to: ConversionHealthStatus,
): TransitionCopy | null {
  // Working → degraded
  if (from === "working" && to === "stale") {
    return {
      severity: "warning",
      title: (n) => `Conversion tracking degrading: ${n}`,
      body: ({ actionName, accountLabel, reason, daysSinceLastFire }) =>
        `On ${accountLabel}, the conversion action "${actionName}" hasn't fired ` +
        `in ${daysSinceLastFire ?? "—"} days (was firing regularly). ` +
        `Reason: ${reason}. This is usually a recent site change or tag ` +
        `manager misconfig — worth a quick check before it goes fully broken.`,
    };
  }
  if (from === "working" && to === "broken") {
    return {
      severity: "error",
      title: (n) => `Conversion tracking broken: ${n}`,
      body: ({ actionName, accountLabel, reason, daysSinceLastFire }) =>
        `On ${accountLabel}, the conversion action "${actionName}" has stopped ` +
        `firing entirely (${daysSinceLastFire ?? "—"} days). ${reason} ` +
        `Smart bidding will degrade until this is fixed. Repair the snippet ` +
        `or re-install via the Conversion tracking hub.`,
    };
  }
  // Escalation: stale → broken (already warned, now confirmed)
  if (from === "stale" && to === "broken") {
    return {
      severity: "error",
      title: (n) => `Conversion tracking confirmed broken: ${n}`,
      body: ({ actionName, accountLabel, reason }) =>
        `${actionName} has now been silent long enough that we consider it ` +
        `broken on ${accountLabel}. ${reason} Repair from the tracking hub.`,
    };
  }
  // Recovery
  if ((from === "broken" || from === "stale") && to === "working") {
    return {
      severity: "info",
      title: (n) => `Conversion tracking restored: ${n}`,
      body: ({ actionName, accountLabel }) =>
        `${actionName} is firing again on ${accountLabel}. Smart bidding ` +
        `signal is restored.`,
    };
  }
  // We deliberately don't notify on inactive transitions or stale→working
  // -> stale flicker. (Inactive means "no baseline yet" which is normal.)
  return null;
}
