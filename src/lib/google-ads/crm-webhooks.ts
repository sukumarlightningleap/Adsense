/**
 * CRM webhook plumbing — Phase B6.
 *
 * Each AdsAccount can have one CrmWebhookConfig per CRM source
 * (hubspot / pipedrive / zoho). The config holds a per-account secret
 * + the ConversionAction these webhooks feed into + (optional) match
 * rules so the customer can filter "only this deal stage".
 *
 *   - `getOrCreateConfig`  → fetch by (account, source), creating with a
 *                            fresh secret if it doesn't exist yet
 *   - `rotateSecret`       → mint a new secret (old one stops working)
 *   - `setConfig`          → assign which conversion action feeds + rules
 *   - `verifyWebhookAuth`  → header check for incoming POSTs
 *   - `webhookUrl`         → public URL string the customer pastes into
 *                            HubSpot / Pipedrive / Zoho
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export type CrmSource = "hubspot" | "pipedrive";

const ALLOWED_SOURCES: CrmSource[] = ["hubspot", "pipedrive"];

// ===========================================================================
// Config fetch / mutate
// ===========================================================================

export async function getOrCreateConfig(opts: {
  accountId: string;
  source: CrmSource;
}) {
  let config = await db.crmWebhookConfig.findFirst({
    where: { accountId: opts.accountId, source: opts.source },
  });
  if (!config) {
    config = await db.crmWebhookConfig.create({
      data: {
        accountId: opts.accountId,
        source: opts.source,
        secret: randomBytes(32).toString("hex"),
      },
    });
  }
  return config;
}

export async function rotateSecret(opts: {
  accountId: string;
  source: CrmSource;
}) {
  const config = await getOrCreateConfig(opts);
  return db.crmWebhookConfig.update({
    where: { id: config.id },
    data: { secret: randomBytes(32).toString("hex") },
  });
}

export async function setConfig(opts: {
  accountId: string;
  source: CrmSource;
  conversionActionId: string | null;
  rules?: Record<string, unknown> | null;
}) {
  const config = await getOrCreateConfig({
    accountId: opts.accountId,
    source: opts.source,
  });
  return db.crmWebhookConfig.update({
    where: { id: config.id },
    data: {
      conversionActionId: opts.conversionActionId,
      rules:
        opts.rules == null
          ? Prisma.JsonNull
          : (opts.rules as Prisma.InputJsonValue),
    },
  });
}

// ===========================================================================
// Auth — header check
// ===========================================================================

const HEADER = "x-adsense-webhook-secret";

export async function verifyWebhookAuth(opts: {
  accountId: string;
  source: CrmSource;
  request: Request;
}): Promise<
  | { ok: true; config: Awaited<ReturnType<typeof getOrCreateConfig>> }
  | { ok: false; error: string; status: number }
> {
  if (!isAllowedSource(opts.source)) {
    return { ok: false, error: "Unknown CRM source.", status: 400 };
  }
  const provided = opts.request.headers.get(HEADER);
  if (!provided) {
    return {
      ok: false,
      error: `Missing ${HEADER} header.`,
      status: 401,
    };
  }
  const config = await db.crmWebhookConfig.findFirst({
    where: { accountId: opts.accountId, source: opts.source },
  });
  if (!config) {
    return {
      ok: false,
      error: "No webhook config for this account/source. Set one up first.",
      status: 404,
    };
  }
  // Constant-time compare.
  const a = Buffer.from(provided);
  const b = Buffer.from(config.secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Invalid secret.", status: 403 };
  }
  return { ok: true, config };
}

export async function bumpFireCount(configId: string) {
  await db.crmWebhookConfig.update({
    where: { id: configId },
    data: { lastFireAt: new Date(), fireCount: { increment: 1 } },
  });
}

// ===========================================================================
// Public webhook URL builder
// ===========================================================================

export function webhookUrl(opts: {
  baseUrl: string;
  accountId: string;
  source: CrmSource;
}): string {
  // Strip trailing slash from baseUrl for a clean join.
  const base = opts.baseUrl.replace(/\/+$/, "");
  return `${base}/api/webhooks/conversions/${opts.source}/${opts.accountId}`;
}

export function isAllowedSource(s: string): s is CrmSource {
  return ALLOWED_SOURCES.includes(s as CrmSource);
}
