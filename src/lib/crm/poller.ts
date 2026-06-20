/**
 * CRM polling loop — Phase B6.1.
 *
 * For each connected CRM (across all accounts), every cron tick:
 *   1. Resolve a fresh access token (refresh if needed)
 *   2. Fetch deals updated since the connection's watermark
 *   3. For each deal whose stage matches a configured rule, enqueue
 *      an offline conversion
 *   4. Advance the watermark to the latest deal we processed
 *
 * The output of this loop is `PendingOfflineConversion` rows; the
 * existing `/api/cron/upload-offline-conversions` cron actually pushes
 * them to Google.
 */
import { db } from "@/lib/db";

import { enqueueConversion } from "@/lib/google-ads/offline-uploads";

import { listRecentDeals } from "./adapters";
import { getFreshAccessToken } from "./oauth";
import type { CrmProviderId } from "./providers";

export type PollResult = {
  connectionId: string;
  provider: string;
  dealsScanned: number;
  matched: number;
  enqueued: number;
  errors: string[];
};

const FALLBACK_LOOKBACK_DAYS = 7;

export async function pollAllConnections(): Promise<PollResult[]> {
  const connections = await db.crmOAuthConnection.findMany();
  const out: PollResult[] = [];
  for (const conn of connections) {
    try {
      const r = await pollOne(conn.id);
      out.push(r);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await db.crmOAuthConnection.update({
        where: { id: conn.id },
        data: { lastPollError: err, lastPolledAt: new Date() },
      });
      out.push({
        connectionId: conn.id,
        provider: conn.provider,
        dealsScanned: 0,
        matched: 0,
        enqueued: 0,
        errors: [err],
      });
    }
  }
  return out;
}

export async function pollOne(connectionId: string): Promise<PollResult> {
  const conn = await db.crmOAuthConnection.findFirst({
    where: { id: connectionId },
  });
  if (!conn) throw new Error("Connection not found");

  const since =
    conn.lastDealUpdatedAt ??
    new Date(Date.now() - FALLBACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const stageRules = parseStageRules(conn.stageRules);
  if (Object.keys(stageRules).length === 0) {
    // No rules → nothing to enqueue. Still advance the watermark so we
    // don't re-scan the same window indefinitely.
    await db.crmOAuthConnection.update({
      where: { id: conn.id },
      data: { lastPolledAt: new Date() },
    });
    return {
      connectionId: conn.id,
      provider: conn.provider,
      dealsScanned: 0,
      matched: 0,
      enqueued: 0,
      errors: ["No stage rules configured — nothing to do."],
    };
  }

  const accessToken = await getFreshAccessToken(conn.id);
  const deals = await listRecentDeals({
    provider: conn.provider as CrmProviderId,
    accessToken,
    sinceDate: since,
    region: conn.region,
  });

  let matched = 0;
  let enqueued = 0;
  const errors: string[] = [];
  let latestUpdated = since;

  for (const d of deals) {
    if (d.updatedAt.getTime() > latestUpdated.getTime()) {
      latestUpdated = d.updatedAt;
    }
    const conversionActionId = stageRules[d.stageId];
    if (!conversionActionId) continue;
    matched += 1;
    if (!d.gclid) {
      errors.push(
        `Deal ${d.id} matched stage ${d.stageId} but has no gclid — skipped.`,
      );
      continue;
    }
    const valueMicros =
      d.amount != null && Number.isFinite(d.amount)
        ? BigInt(Math.round(d.amount * 1_000_000))
        : null;
    const res = await enqueueConversion({
      accountId: conn.accountId,
      conversionActionId,
      gclid: d.gclid,
      conversionDateTime: d.updatedAt,
      valueMicros,
      currencyCode: d.currency ?? null,
      orderId: null,
      source: conn.provider as "hubspot" | "pipedrive" | "zoho",
      externalId: `${conn.provider}-deal-${d.id}`,
    });
    if (res.ok) {
      enqueued += 1;
    } else {
      errors.push(`Deal ${d.id}: ${res.error}`);
    }
  }

  await db.crmOAuthConnection.update({
    where: { id: conn.id },
    data: {
      lastPolledAt: new Date(),
      lastDealUpdatedAt: latestUpdated,
      lastPollError: errors.length > 0 ? errors.slice(0, 5).join("; ") : null,
    },
  });

  return {
    connectionId: conn.id,
    provider: conn.provider,
    dealsScanned: deals.length,
    matched,
    enqueued,
    errors,
  };
}

function parseStageRules(raw: unknown): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}
