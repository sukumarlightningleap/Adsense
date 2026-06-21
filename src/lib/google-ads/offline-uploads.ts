/**
 * Offline conversion upload pipeline — Phase B6/B8.
 *
 * Every "offline" conversion (CRM-qualified lead, CSV row, GA4-offline,
 * one-off manual entry) lands in `PendingOfflineConversion` with
 * `status='pending'`. The cron at `/api/cron/upload-offline-conversions`
 * picks them up in batches per (account × conversionAction), calls
 * `customer.conversionUploads.uploadClickConversions(...)`, and flips
 * each row to `uploaded` or `failed`.
 *
 *   - `enqueueConversion`   → called by webhook handlers + CSV importer
 *   - `uploadPendingBatch`  → the cron's per-account worker
 *   - `processAllPending`   → entry point the cron route calls
 *
 * Dedupe — the unique key (accountId, source, externalId) on the row
 * means HubSpot retrying the same deal-stage-change webhook never
 * uploads twice.
 */
import { type Customer, type services } from "google-ads-api";

import { db } from "@/lib/db";

import { buildCustomerForAccount } from "./client";

// ===========================================================================
// Types
// ===========================================================================

export type EnqueueResult =
  | { ok: true; pendingId: string; deduped: boolean }
  | { ok: false; error: string };

export type EnqueueInput = {
  accountId: string;
  conversionActionId: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  conversionDateTime: Date;
  valueMicros?: bigint | null;
  currencyCode?: string | null;
  orderId?: string | null;
  source: "hubspot" | "pipedrive" | "csv" | "manual" | "ga4_offline";
  externalId?: string | null;
};

// ===========================================================================
// Enqueue — called by webhook handlers + CSV importer
// ===========================================================================

export async function enqueueConversion(
  input: EnqueueInput,
): Promise<EnqueueResult> {
  if (!input.gclid && !input.gbraid && !input.wbraid) {
    return {
      ok: false,
      error:
        "At least one of gclid / gbraid / wbraid is required to attribute an offline conversion.",
    };
  }

  // Confirm the conversion action exists + belongs to the account.
  const action = await db.conversionAction.findFirst({
    where: { id: input.conversionActionId, accountId: input.accountId },
    select: { id: true, providerConversionId: true, status: true },
  });
  if (!action) {
    return { ok: false, error: "Conversion action not found on this account." };
  }
  if (!action.providerConversionId) {
    return {
      ok: false,
      error: "Conversion action is not yet live in Google Ads.",
    };
  }
  if (action.status !== "ENABLED") {
    return {
      ok: false,
      error: `Conversion action is ${action.status} — cannot accept uploads.`,
    };
  }

  // Dedupe: same (accountId, source, externalId) tuple? Reuse the row.
  if (input.externalId) {
    const existing = await db.pendingOfflineConversion.findFirst({
      where: {
        accountId: input.accountId,
        source: input.source,
        externalId: input.externalId,
      },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, pendingId: existing.id, deduped: true };
    }
  }

  const row = await db.pendingOfflineConversion.create({
    data: {
      accountId: input.accountId,
      conversionActionId: input.conversionActionId,
      gclid: input.gclid ?? null,
      gbraid: input.gbraid ?? null,
      wbraid: input.wbraid ?? null,
      conversionDateTime: input.conversionDateTime,
      valueMicros: input.valueMicros ?? null,
      currencyCode: input.currencyCode ?? null,
      orderId: input.orderId ?? null,
      source: input.source,
      externalId: input.externalId ?? null,
    },
  });
  return { ok: true, pendingId: row.id, deduped: false };
}

// ===========================================================================
// Upload — per-account batch
// ===========================================================================

export type UploadResult = {
  accountId: string;
  uploaded: number;
  failed: number;
  errors: string[];
};

const BATCH_MAX = 2000; // Google's per-request cap

export async function uploadPendingForAccount(opts: {
  accountId: string;
}): Promise<UploadResult> {
  const account = await db.adsAccount.findFirst({
    where: { id: opts.accountId },
  });
  if (!account) {
    return {
      accountId: opts.accountId,
      uploaded: 0,
      failed: 0,
      errors: ["Account not found"],
    };
  }
  const customer = buildCustomerForAccount(account);
  const customerIdNum = account.customerId.replace(/-/g, "");

  // Pull pending rows + their action's provider ID in a single query.
  const pending = await db.pendingOfflineConversion.findMany({
    where: { accountId: opts.accountId, status: "pending" },
    include: {
      conversionAction: {
        select: { providerConversionId: true },
      },
    },
    take: BATCH_MAX,
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) {
    return { accountId: opts.accountId, uploaded: 0, failed: 0, errors: [] };
  }

  // Build the request payload.
  const conversions: services.IClickConversion[] = pending
    .filter((r) => !!r.conversionAction.providerConversionId)
    .map((r) => {
      const conversionAction = `customers/${customerIdNum}/conversionActions/${r.conversionAction.providerConversionId}`;
      const conv: services.IClickConversion = {
        conversion_action: conversionAction,
        // Google wants ISO-8601 with timezone, e.g.
        // "2025-08-15 12:34:56+00:00" (with a space; no T). The SDK
        // accepts the proto-canonical "+00:00 yyyy-MM-dd HH:mm:ss"
        // form. We format from JS Date below.
        conversion_date_time: toGoogleDateTime(r.conversionDateTime),
      };
      if (r.gclid) conv.gclid = r.gclid;
      if (r.gbraid) conv.gbraid = r.gbraid;
      if (r.wbraid) conv.wbraid = r.wbraid;
      if (r.valueMicros != null) {
        conv.conversion_value = Number(r.valueMicros) / 1_000_000;
        conv.currency_code = r.currencyCode ?? "USD";
      }
      if (r.orderId) conv.order_id = r.orderId;
      return conv;
    });

  if (conversions.length === 0) {
    return { accountId: opts.accountId, uploaded: 0, failed: 0, errors: [] };
  }

  // Use partial_failure so a single bad row doesn't kill the batch.
  // The Opteo SDK accepts a plain object that matches IUploadClick-
  // ConversionsRequest at runtime, but its .d.ts signature insists on
  // the strict proto class. Cast through unknown — same pattern other
  // SDK wrappers in this codebase use.
  //
  // KNOWN ISSUE (B6.2): Google deprecated UploadClickConversions for new
  // integrations starting 2026; new Ads accounts get a clean rejection
  // pointing to the Data Manager API. Existing/grandfathered accounts
  // can still use this endpoint. The migration is tracked as a separate
  // task — see Phase B6.2 in PROGRESS.md or the backlog. Until that
  // ships, we detect the deprecation error explicitly and pause those
  // rows in a 'deferred_data_manager' status so they survive for the
  // future Data Manager backfill instead of being lost.
  let response: services.UploadClickConversionsResponse;
  try {
    response = await customer.conversionUploads.uploadClickConversions({
      customer_id: customerIdNum,
      conversions,
      partial_failure: true,
      validate_only: false,
    } as unknown as services.UploadClickConversionsRequest);
  } catch (e) {
    // Whole batch died — categorize the error so customers see what's
    // actually wrong (auth issue vs deprecation vs invalid data).
    const errMsg = extractGoogleError(e);
    const isDeprecation =
      errMsg.toLowerCase().includes("data manager api") ||
      errMsg
        .toLowerCase()
        .includes("uploadclickconversions is limited to existing users");
    const newStatus = isDeprecation ? "deferred_data_manager" : "failed";
    const surface = isDeprecation
      ? "Google migrated this endpoint to the new Data Manager API for new accounts. Your conversions are safely queued — they'll auto-upload once we ship the migration."
      : errMsg;
    await db.pendingOfflineConversion.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: {
        status: newStatus,
        attempts: { increment: 1 },
        lastError: surface,
      },
    });
    return {
      accountId: opts.accountId,
      uploaded: 0,
      failed: pending.length,
      errors: [surface],
    };
  }

  // Walk the response. `partial_failure_error` lists indices that
  // failed; results array is aligned 1:1 with the input.
  const partialErrors = parsePartialFailureErrors(response, conversions.length);
  let uploaded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < pending.length; i += 1) {
    const row = pending[i]!;
    const partial = partialErrors[i];
    if (partial) {
      failed += 1;
      errors.push(partial);
      await db.pendingOfflineConversion.update({
        where: { id: row.id },
        data: {
          status: "failed",
          attempts: { increment: 1 },
          lastError: partial,
        },
      });
    } else {
      uploaded += 1;
      await db.pendingOfflineConversion.update({
        where: { id: row.id },
        data: {
          status: "uploaded",
          attempts: { increment: 1 },
          uploadedAt: new Date(),
          lastError: null,
        },
      });
    }
  }

  return { accountId: opts.accountId, uploaded, failed, errors };
}

// ===========================================================================
// Top-level — find all accounts with pending rows and process each
// ===========================================================================

export async function processAllPending(): Promise<UploadResult[]> {
  const grouped = await db.pendingOfflineConversion.groupBy({
    by: ["accountId"],
    where: { status: "pending" },
    _count: { id: true },
  });
  const out: UploadResult[] = [];
  for (const g of grouped) {
    const res = await uploadPendingForAccount({ accountId: g.accountId });
    out.push(res);
  }
  return out;
}

// ===========================================================================
// Helpers
// ===========================================================================

function toGoogleDateTime(d: Date): string {
  // Google Ads API expects "YYYY-MM-DD HH:mm:ss+00:00" in UTC.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}

function parsePartialFailureErrors(
  response: services.UploadClickConversionsResponse,
  count: number,
): Array<string | null> {
  const out: Array<string | null> = Array.from({ length: count }, () => null);
  // partial_failure_error is a google.rpc.Status with serialized
  // GoogleAdsFailure details. We walk those for per-row errors.
  const err = response.partial_failure_error as
    | { message?: string; details?: unknown[] }
    | null
    | undefined;
  if (!err) return out;
  const details = Array.isArray(err.details) ? err.details : [];
  for (const d of details) {
    const det = d as { errors?: unknown[] } | undefined;
    if (!det?.errors) continue;
    for (const e of det.errors) {
      const ee = e as
        | {
            message?: string;
            location?: {
              field_path_elements?: Array<{ index?: number | null }>;
            };
          }
        | undefined;
      const path = ee?.location?.field_path_elements ?? [];
      const operationIdx = path[0]?.index;
      if (typeof operationIdx === "number" && operationIdx < count) {
        out[operationIdx] = ee?.message ?? "Unknown upload error";
      }
    }
  }
  // If we got a top-level message but no per-row mapping, attribute it
  // to all rows in the batch.
  if (err.message && out.every((v) => v == null)) {
    return out.map(() => err.message ?? "Upload error");
  }
  return out;
}

function extractGoogleError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      return obj.errors
        .map((er) => {
          if (typeof er === "object" && er !== null) {
            const m = (er as { message?: unknown }).message;
            if (typeof m === "string") return m;
          }
          return String(er);
        })
        .join("; ");
    }
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable]";
    }
  }
  return String(e);
}

// Acknowledge Customer is intentionally typed via the SDK even though
// we don't directly reference it as a value — keeps the import non-
// orphaned and the file self-documenting about which surface we depend on.
export type _AdsCustomer = Customer;
