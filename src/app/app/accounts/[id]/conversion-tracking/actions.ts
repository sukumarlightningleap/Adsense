"use server";

/**
 * Server actions for the Conversion Tracking hub
 * (/app/accounts/[id]/conversion-tracking).
 *
 * Thin wrappers around `lib/google-ads/conversions.ts` — they bolt on
 * the session check, demo-mode block, and revalidate the hub path so
 * the next render reflects the change.
 */
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  buildGtagSnippets,
  checkConversionFire,
  createConversionActionInGoogle,
  createGa4ConversionAction,
  fetchTagSnippetsFromGoogle,
  setConversionActionPrimary,
  setConversionActionStatus,
  setTagInstalled,
  type CheckFireResult,
  type CreateConversionInput,
  type CreateGa4ConversionInput,
  type GtagSnippets,
} from "@/lib/google-ads/conversions";
import {
  getOrCreateConfig,
  rotateSecret,
  setConfig,
  webhookUrl,
  type CrmSource,
} from "@/lib/google-ads/crm-webhooks";
import { enqueueConversion } from "@/lib/google-ads/offline-uploads";
import {
  getFreshAccessToken,
} from "@/lib/crm/oauth";
import { listPipelines } from "@/lib/crm/adapters";
import { pollOne } from "@/lib/crm/poller";
import type { CrmProviderId, NormalizedPipeline } from "@/lib/crm/providers";
import {
  listAccessibleProperties,
  listKeyEvents,
  type Ga4KeyEvent,
  type Ga4Property,
} from "@/lib/ga4/admin";

import { Prisma } from "@prisma/client";

import { ConversionCategory } from "@prisma/client";

export type CreateConversionFormInput = {
  accountId: string;
  name: string;
  category: ConversionCategory;
  valueType: "fixed" | "count-only";
  valueAmount?: number;
  countingType: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  isPrimary: boolean;
};

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ===========================================================================
// Create
// ===========================================================================

export async function createConversionAction(
  input: CreateConversionFormInput,
): Promise<ActionResult<{ conversionActionId: string; providerId: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't create conversion actions." };
  }

  const payload: CreateConversionInput = {
    accountId: input.accountId,
    userId: session.user.id,
    name: input.name,
    category: input.category,
    valueType: input.valueType,
    valueAmount: input.valueAmount,
    countingType: input.countingType,
    isPrimary: input.isPrimary,
  };
  const res = await createConversionActionInGoogle(payload);
  if (res.ok) {
    revalidatePath(`/app/accounts/${input.accountId}/conversion-tracking`);
    revalidatePath(`/app/accounts/${input.accountId}/health`);
    revalidatePath(`/app/create`);
  }
  return res;
}

// ===========================================================================
// Status flip
// ===========================================================================

export async function setStatus(
  conversionActionId: string,
  accountId: string,
  newStatus: "ENABLED" | "PAUSED" | "REMOVED",
): Promise<ActionResult<{ newStatus: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't mutate conversion actions." };
  }
  const res = await setConversionActionStatus({
    conversionActionId,
    userId: session.user.id,
    newStatus,
  });
  if (res.ok) {
    revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
    revalidatePath(`/app/accounts/${accountId}/health`);
  }
  return res;
}

// ===========================================================================
// Primary flag flip
// ===========================================================================

export async function setPrimary(
  conversionActionId: string,
  accountId: string,
  isPrimary: boolean,
): Promise<ActionResult<{ isPrimary: boolean }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't mutate conversion actions." };
  }
  const res = await setConversionActionPrimary({
    conversionActionId,
    userId: session.user.id,
    isPrimary,
  });
  if (res.ok) {
    revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  }
  return res;
}

// ===========================================================================
// Tag-installed attestation
// ===========================================================================

export async function markTagInstalled(
  conversionActionId: string,
  accountId: string,
  installed: boolean,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't update tag status." };
  }
  const res = await setTagInstalled({
    conversionActionId,
    userId: session.user.id,
    installed,
  });
  if (res.ok) {
    revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  }
  return res;
}

// ===========================================================================
// Snippet (read-only, but kept here so the hub's snippet sheet doesn't
// need to import directly from the lib layer)
// ===========================================================================

export async function getSnippets(
  conversionActionId: string,
): Promise<
  ActionResult<{
    snippets: GtagSnippets;
    /// True when `baseTag`/`eventTag` came from Google's TagSnippetService
    /// (label already substituted). False when we fell back to the local
    /// placeholder generator (rare — phone/GA4 actions don't have HTML
    /// snippets, or the action was created seconds ago and Google's
    /// snippet hasn't materialized yet).
    fromGoogle: boolean;
  }>
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };

  const action = await db.conversionAction.findFirst({
    where: { id: conversionActionId },
    include: { account: true },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== session.user.id) {
    return { ok: false, error: "Not your conversion action." };
  }
  // Local placeholder snippets always built — used as the fallback +
  // for the GTM trigger JSON + no-script (Google's TagSnippetService
  // doesn't supply those in a useful form).
  const local = buildGtagSnippets({
    customerId: action.account.customerId,
    providerConversionId: action.providerConversionId,
    valueAmount: action.valueMicros
      ? Number(action.valueMicros) / 1_000_000
      : null,
    currencyCode: action.account.currencyCode,
  });

  // Try Google's real snippets (Phase B5.2). Replaces the
  // YOUR_CONVERSION_LABEL placeholder with the actual conversion label.
  let fromGoogle = false;
  let baseTag = local.baseTag;
  let eventTag = local.eventTag;
  let sendTo = local.sendTo;
  if (action.providerConversionId) {
    try {
      const fetched = await fetchTagSnippetsFromGoogle({
        conversionActionId,
        userId: session.user.id,
      });
      if (fetched.ok) {
        fromGoogle = true;
        if (fetched.baseTag) baseTag = fetched.baseTag;
        if (fetched.eventSnippet) eventTag = fetched.eventSnippet;
        if (fetched.sendTo) sendTo = fetched.sendTo;
      }
    } catch {
      // Swallow — local fallback already populated.
    }
  }

  return {
    ok: true,
    fromGoogle,
    snippets: { ...local, baseTag, eventTag, sendTo },
  };
}

// ===========================================================================
// B5 — Create conversion action linked to a GA4 event
// ===========================================================================

export type CreateGa4FormInput = {
  accountId: string;
  name: string;
  category: ConversionCategory;
  ga4PropertyId: string;
  ga4PropertyName: string;
  ga4EventName: string;
  ga4Kind: "custom" | "purchase" | "generate_lead" | "qualify_lead";
  countingType: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  isPrimary: boolean;
};

export async function createGa4Conversion(
  input: CreateGa4FormInput,
): Promise<ActionResult<{ conversionActionId: string; providerId: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't create conversion actions." };
  }
  const payload: CreateGa4ConversionInput = {
    accountId: input.accountId,
    userId: session.user.id,
    name: input.name,
    category: input.category,
    ga4PropertyId: input.ga4PropertyId,
    ga4PropertyName: input.ga4PropertyName,
    ga4EventName: input.ga4EventName,
    ga4Kind: input.ga4Kind,
    countingType: input.countingType,
    isPrimary: input.isPrimary,
  };
  const res = await createGa4ConversionAction(payload);
  if (res.ok) {
    revalidatePath(`/app/accounts/${input.accountId}/conversion-tracking`);
    revalidatePath(`/app/accounts/${input.accountId}/health`);
    revalidatePath("/app/create");
  }
  return res;
}

// ===========================================================================
// B4 — Check-fire (per-row "Check status" button)
// ===========================================================================

export async function checkFire(
  conversionActionId: string,
  accountId: string,
): Promise<CheckFireResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't query Google." };
  }
  const res = await checkConversionFire({
    conversionActionId,
    userId: session.user.id,
    windowDays: 7,
  });
  if (res.ok) {
    revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
    revalidatePath(`/app/accounts/${accountId}/health`);
  }
  return res;
}

// ===========================================================================
// B6 — CRM webhook config (get/rotate secret + bind to conversion action)
// ===========================================================================

export type CrmConfigState = {
  source: CrmSource;
  hasConfig: boolean;
  secret: string | null;
  webhookUrl: string | null;
  conversionActionId: string | null;
  lastFireAt: string | null;
  fireCount: number;
};

export async function getCrmConfig(
  accountId: string,
  source: CrmSource,
): Promise<ActionResult<{ config: CrmConfigState }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };

  const cfg = await getOrCreateConfig({ accountId, source });
  const base = resolvePublicBaseUrl();
  return {
    ok: true,
    config: {
      source,
      hasConfig: true,
      secret: cfg.secret,
      webhookUrl: webhookUrl({ baseUrl: base, accountId, source }),
      conversionActionId: cfg.conversionActionId,
      lastFireAt: cfg.lastFireAt?.toISOString() ?? null,
      fireCount: cfg.fireCount,
    },
  };
}

export async function rotateCrmSecret(
  accountId: string,
  source: CrmSource,
): Promise<ActionResult<{ secret: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't rotate secrets." };
  }
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  const cfg = await rotateSecret({ accountId, source });
  revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  return { ok: true, secret: cfg.secret };
}

export async function bindCrmFeedAction(
  accountId: string,
  source: CrmSource,
  conversionActionId: string | null,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't update CRM config." };
  }
  // Ownership: account is mine, conversion action belongs to it.
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  if (conversionActionId) {
    const action = await db.conversionAction.findFirst({
      where: { id: conversionActionId, accountId },
      select: { id: true },
    });
    if (!action) {
      return {
        ok: false,
        error: "Conversion action not found on this account.",
      };
    }
  }
  await setConfig({ accountId, source, conversionActionId });
  revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  return { ok: true };
}

// ===========================================================================
// B8 — CSV upload (queue rows to PendingOfflineConversion)
// ===========================================================================

export type CsvRowResult =
  | { ok: true; pendingId: string; deduped: boolean; rowIndex: number }
  | { ok: false; rowIndex: number; error: string };

export type CsvUploadInput = {
  accountId: string;
  conversionActionId: string;
  /** Each row: gclid / conversion_date_time / value? / currency? / order_id? / external_id? */
  rows: Array<{
    gclid?: string;
    gbraid?: string;
    wbraid?: string;
    conversionDateTime: string;     // ISO-8601 UTC
    value?: number;
    currency?: string;
    orderId?: string;
    externalId?: string;
  }>;
};

export async function uploadCsvConversions(
  input: CsvUploadInput,
): Promise<
  ActionResult<{ enqueued: number; deduped: number; errors: CsvRowResult[] }>
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't upload conversions." };
  }
  if (input.rows.length === 0) {
    return { ok: false, error: "No rows in upload." };
  }
  if (input.rows.length > 5000) {
    return {
      ok: false,
      error: "CSV upload capped at 5000 rows per request. Split into batches.",
    };
  }

  // Ownership + action validity check upfront so we don't enqueue
  // anything if the inputs are bad.
  const account = await db.adsAccount.findFirst({
    where: { id: input.accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  const action = await db.conversionAction.findFirst({
    where: { id: input.conversionActionId, accountId: input.accountId },
    select: { id: true, status: true, providerConversionId: true },
  });
  if (!action) {
    return {
      ok: false,
      error: "Conversion action not found on this account.",
    };
  }
  if (!action.providerConversionId) {
    return {
      ok: false,
      error: "Conversion action isn't live in Google Ads yet.",
    };
  }

  let enqueued = 0;
  let deduped = 0;
  const errors: CsvRowResult[] = [];

  for (let i = 0; i < input.rows.length; i += 1) {
    const r = input.rows[i]!;
    const date = new Date(r.conversionDateTime);
    if (Number.isNaN(date.getTime())) {
      errors.push({
        ok: false,
        rowIndex: i,
        error: `Row ${i + 1}: invalid conversion_date_time`,
      });
      continue;
    }
    const valueMicros =
      r.value != null && Number.isFinite(r.value)
        ? BigInt(Math.round(r.value * 1_000_000))
        : null;
    const res = await enqueueConversion({
      accountId: input.accountId,
      conversionActionId: input.conversionActionId,
      gclid: r.gclid,
      gbraid: r.gbraid,
      wbraid: r.wbraid,
      conversionDateTime: date,
      valueMicros,
      currencyCode: r.currency ?? null,
      orderId: r.orderId ?? null,
      source: "csv",
      externalId: r.externalId ?? null,
    });
    if (!res.ok) {
      errors.push({ ok: false, rowIndex: i, error: res.error });
      continue;
    }
    enqueued += 1;
    if (res.deduped) deduped += 1;
  }

  revalidatePath(`/app/accounts/${input.accountId}/conversion-tracking`);
  return { ok: true, enqueued, deduped, errors };
}

// ===========================================================================
// B6.1 — CRM OAuth connection state + pipeline listing + rule editing
// ===========================================================================

export type CrmOAuthState = {
  provider: CrmProviderId;
  connected: boolean;
  connectionId: string | null;
  region: string | null;
  lastPolledAt: string | null;
  lastDealUpdatedAt: string | null;
  lastPollError: string | null;
  stageRules: Record<string, string>;
  /// Where to send the user to start the OAuth flow. Populated even
  /// when not yet connected.
  startUrl: string;
};

export async function getCrmOAuthState(
  accountId: string,
  provider: CrmProviderId,
): Promise<ActionResult<{ state: CrmOAuthState }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };

  const conn = await db.crmOAuthConnection.findFirst({
    where: { accountId, provider },
  });
  const startUrl = `/api/crm/oauth/${provider}/start?accountId=${accountId}`;
  return {
    ok: true,
    state: {
      provider,
      connected: !!conn,
      connectionId: conn?.id ?? null,
      region: conn?.region ?? null,
      lastPolledAt: conn?.lastPolledAt?.toISOString() ?? null,
      lastDealUpdatedAt: conn?.lastDealUpdatedAt?.toISOString() ?? null,
      lastPollError: conn?.lastPollError ?? null,
      stageRules:
        conn?.stageRules && typeof conn.stageRules === "object"
          ? (conn.stageRules as Record<string, string>)
          : {},
      startUrl,
    },
  };
}

export async function disconnectCrmOauth(
  accountId: string,
  provider: CrmProviderId,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't disconnect CRMs." };
  }
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  await db.crmOAuthConnection.deleteMany({
    where: { accountId, provider },
  });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "crm.oauth_disconnect",
      targetKind: "ads_account",
      targetId: account.id,
      payload: { provider },
    },
  });
  revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  return { ok: true };
}

export async function listCrmPipelines(
  accountId: string,
  provider: CrmProviderId,
): Promise<ActionResult<{ pipelines: NormalizedPipeline[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  const conn = await db.crmOAuthConnection.findFirst({
    where: { accountId, provider },
  });
  if (!conn) {
    return { ok: false, error: "Not connected — start OAuth first." };
  }
  try {
    const token = await getFreshAccessToken(conn.id);
    const pipelines = await listPipelines({
      provider,
      accessToken: token,
      region: conn.region,
    });
    return { ok: true, pipelines };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Pipeline fetch failed.",
    };
  }
}

export async function saveStageRules(
  accountId: string,
  provider: CrmProviderId,
  rules: Record<string, string>,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't edit CRM rules." };
  }
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  const conn = await db.crmOAuthConnection.findFirst({
    where: { accountId, provider },
  });
  if (!conn) return { ok: false, error: "Not connected — start OAuth first." };

  // Validate every conversion-action id in `rules` belongs to this account.
  const actionIds = Array.from(new Set(Object.values(rules)));
  if (actionIds.length > 0) {
    const valid = await db.conversionAction.findMany({
      where: { accountId, id: { in: actionIds } },
      select: { id: true },
    });
    const validSet = new Set(valid.map((v) => v.id));
    const cleaned: Record<string, string> = {};
    for (const [stageId, actionId] of Object.entries(rules)) {
      if (validSet.has(actionId)) cleaned[stageId] = actionId;
    }
    rules = cleaned;
  }

  await db.crmOAuthConnection.update({
    where: { id: conn.id },
    data: { stageRules: rules as Prisma.InputJsonValue },
  });
  revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  return { ok: true };
}

export async function pollCrmNow(
  accountId: string,
  provider: CrmProviderId,
): Promise<
  ActionResult<{
    dealsScanned: number;
    matched: number;
    enqueued: number;
    errors: string[];
  }>
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't trigger polls." };
  }
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  const conn = await db.crmOAuthConnection.findFirst({
    where: { accountId, provider },
  });
  if (!conn) return { ok: false, error: "Not connected." };
  try {
    const r = await pollOne(conn.id);
    revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
    return {
      ok: true,
      dealsScanned: r.dealsScanned,
      matched: r.matched,
      enqueued: r.enqueued,
      errors: r.errors,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Poll failed.",
    };
  }
}

// ===========================================================================
// B5.1 — GA4 OAuth state + property/event listing + disconnect
// ===========================================================================

export type Ga4ConnectionState = {
  connected: boolean;
  oauthEmail: string | null;
  startUrl: string;
};

export async function getGa4ConnectionState(
  accountId: string,
): Promise<ActionResult<{ state: Ga4ConnectionState }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  const conn = await db.ga4OAuthConnection.findFirst({
    where: { accountId },
    select: { oauthEmail: true },
  });
  return {
    ok: true,
    state: {
      connected: !!conn,
      oauthEmail: conn?.oauthEmail ?? null,
      startUrl: `/api/ga4/oauth/start?accountId=${accountId}`,
    },
  };
}

export async function disconnectGa4(
  accountId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't disconnect GA4." };
  }
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  await db.ga4OAuthConnection.deleteMany({ where: { accountId } });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ga4.oauth_disconnect",
      targetKind: "ads_account",
      targetId: account.id,
      payload: {},
    },
  });
  revalidatePath(`/app/accounts/${accountId}/conversion-tracking`);
  return { ok: true };
}

export async function listGa4Properties(
  accountId: string,
): Promise<ActionResult<{ properties: Ga4Property[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  try {
    const properties = await listAccessibleProperties(accountId);
    return { ok: true, properties };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "GA4 properties fetch failed.",
    };
  }
}

export async function listGa4KeyEvents(
  accountId: string,
  propertyId: string,
): Promise<ActionResult<{ events: Ga4KeyEvent[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };
  try {
    const events = await listKeyEvents({ accountId, propertyId });
    return { ok: true, events };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "GA4 events fetch failed.",
    };
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function resolvePublicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim().replace(/^/, "https://") ||
    "http://localhost:3000"
  );
}
