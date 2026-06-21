/**
 * POST /api/webhooks/conversions/[source]/[accountId]
 *
 * Generic CRM webhook receiver. The customer's CRM (HubSpot,
 * Pipedrive, Zoho) POSTs here with their lead's gclid + deal info when
 * a configured trigger fires (e.g. deal stage → Qualified).
 *
 * Auth: `X-Adsense-Webhook-Secret` header must match the secret
 * generated when the customer connected this CRM (see CrmWebhookConfig).
 *
 * Body shape (consistent across all 3 sources — the customer maps their
 * CRM's payload to this shape via a built-in webhook transformer or a
 * Zapier-style hop):
 *
 *   {
 *     "gclid": "EAIaIQobChMI...",       // OR gbraid / wbraid
 *     "conversion_date_time": "2026-06-20T18:30:00Z",  // ISO-8601 UTC
 *     "value": 350.00,                  // optional, USD by default
 *     "currency": "USD",                // optional
 *     "external_id": "deal-12345",      // optional, for dedupe
 *     "order_id": "ORDER-9876",         // optional
 *     "conversion_action_id": "..."     // optional override; defaults
 *                                       // to the config's mapped action
 *   }
 *
 * 202 Accepted = queued for upload. The 15-min cron actually pushes to
 * Google. We never call Google synchronously from a webhook handler —
 * keeps response times deterministic for the CRM's retry behaviour.
 */
import { NextResponse } from "next/server";

import { enqueueConversion } from "@/lib/google-ads/offline-uploads";
import {
  bumpFireCount,
  isAllowedSource,
  verifyWebhookAuth,
} from "@/lib/google-ads/crm-webhooks";

type Params = Promise<{ source: string; accountId: string }>;

export async function POST(
  req: Request,
  { params }: { params: Params },
) {
  const { source, accountId } = await params;
  if (!isAllowedSource(source)) {
    return NextResponse.json(
      { ok: false, error: "Unknown source." },
      { status: 400 },
    );
  }

  // Auth
  const auth = await verifyWebhookAuth({ accountId, source, request: req });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  const config = auth.config;

  // Body
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const gclid = stringOrNull(body.gclid);
  const gbraid = stringOrNull(body.gbraid);
  const wbraid = stringOrNull(body.wbraid);
  if (!gclid && !gbraid && !wbraid) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "At least one of gclid / gbraid / wbraid must be present in the body.",
      },
      { status: 400 },
    );
  }

  const dateRaw = stringOrNull(body.conversion_date_time);
  const conversionDate = dateRaw ? new Date(dateRaw) : new Date();
  if (Number.isNaN(conversionDate.getTime())) {
    return NextResponse.json(
      {
        ok: false,
        error: "conversion_date_time must be a valid ISO-8601 datetime string.",
      },
      { status: 400 },
    );
  }

  const conversionActionId =
    stringOrNull(body.conversion_action_id) ?? config.conversionActionId;
  if (!conversionActionId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No conversion_action_id supplied and no default action mapped on this CRM config.",
      },
      { status: 400 },
    );
  }

  const value = numberOrNull(body.value);
  const valueMicros =
    value != null ? BigInt(Math.round(value * 1_000_000)) : null;
  const currency = stringOrNull(body.currency);
  const externalId = stringOrNull(body.external_id);
  const orderId = stringOrNull(body.order_id);

  const enqueued = await enqueueConversion({
    accountId,
    conversionActionId,
    gclid: gclid ?? undefined,
    gbraid: gbraid ?? undefined,
    wbraid: wbraid ?? undefined,
    conversionDateTime: conversionDate,
    valueMicros,
    currencyCode: currency,
    orderId,
    source: source as "hubspot" | "pipedrive",
    externalId,
  });
  if (!enqueued.ok) {
    return NextResponse.json(
      { ok: false, error: enqueued.error },
      { status: 422 },
    );
  }

  await bumpFireCount(config.id);

  return NextResponse.json(
    {
      ok: true,
      queued: true,
      pendingId: enqueued.pendingId,
      deduped: enqueued.deduped,
    },
    { status: 202 },
  );
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return null;
}
