/**
 * Conversion-action lifecycle helpers — Phase B2.
 *
 * Two flavors of "create":
 *
 *   1. createConversionActionInGoogle — the customer asks for a new
 *      tracking goal we don't yet have. We push it to Google via
 *      `customer.conversionActions.create(...)`, then mirror in our DB
 *      with source='created'. Used by the Hub page's "+ Add" button and
 *      (transitively) by the Create-form when the customer opens the
 *      inline-create sheet.
 *
 *   2. The importer already handles the OPPOSITE direction — pulling
 *      Google's existing conversion actions into our DB with
 *      source='imported'. We don't touch that path here.
 *
 * Other mutations:
 *   - setConversionActionStatus  → pause / enable a row in Google + DB
 *   - setConversionActionPrimary → flip primary_for_goal in Google + DB
 *   - setTagInstalled            → DB-only flag — customer attests they
 *                                  pasted the snippet (before Google has
 *                                  actually seen a fire). Lets bidding
 *                                  unlock in 'learning' mode.
 *
 * Snippet rendering:
 *   - buildGtagSnippets  → reusable; powers both the Hub page and the
 *                          existing /health repair flow. Lifts the
 *                          duplicated logic out of repair-action.ts.
 */
import { enums } from "google-ads-api";
import type {
  CampaignStatus,
  ConversionCategory,
} from "@prisma/client";

import { db } from "@/lib/db";

import { buildCustomerForAccount } from "./client";

// ===========================================================================
// Types
// ===========================================================================

export type CreateConversionInput = {
  accountId: string;
  userId: string;
  name: string;
  category: ConversionCategory;
  valueType: "fixed" | "count-only";
  valueAmount?: number;          // USD; only when valueType='fixed'
  countingType: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  isPrimary: boolean;
};

export type CreateConversionResult =
  | { ok: true; conversionActionId: string; providerId: string }
  | { ok: false; error: string };

export type SetConversionStatusResult =
  | { ok: true; newStatus: CampaignStatus }
  | { ok: false; error: string };

export type SetPrimaryResult =
  | { ok: true; isPrimary: boolean }
  | { ok: false; error: string };

export type CheckFireResult =
  | {
      ok: true;
      // Conversion count Google reports for the last `days` window.
      recentCount: number;
      // Last-fire timestamp Google has on file (null = never fired).
      lastFireAt: Date | null;
      // Days the query covered (mirrors the input).
      windowDays: number;
    }
  | { ok: false; error: string };

// ===========================================================================
// Create — push a new ConversionAction to Google, mirror in our DB
// ===========================================================================

export async function createConversionActionInGoogle(
  input: CreateConversionInput,
): Promise<CreateConversionResult> {
  // 1) Ownership + account validity check.
  const account = await db.adsAccount.findFirst({
    where: { id: input.accountId, userId: input.userId, demoMode: false },
  });
  if (!account) return { ok: false, error: "Account not found." };
  if (account.isManager) {
    return {
      ok: false,
      error:
        "Conversion actions can't be created on a manager account. Pick the sub-account that will receive the leads.",
    };
  }

  // 2) Sanity on the name — Google rejects empty / overly long names.
  const name = input.name.trim().slice(0, 100);
  if (!name) return { ok: false, error: "Name is required." };

  // 3) Map our enum → Google's int enum.
  const categoryInt = mapCategoryToGoogle(input.category);
  const countingInt =
    input.countingType === "MANY_PER_CLICK"
      ? enums.ConversionActionCountingType.MANY_PER_CLICK
      : enums.ConversionActionCountingType.ONE_PER_CLICK;

  // 4) Build value settings. PHONE_CALL_LEAD uses CLICK_TO_CALL type;
  //    everything else uses WEBPAGE (the gtag/GTM path).
  const isPhone = input.category === "PHONE_CALL_LEAD";
  const typeInt = isPhone
    ? enums.ConversionActionType.WEBSITE_CALL
    : enums.ConversionActionType.WEBPAGE;

  const valueDefault =
    input.valueType === "fixed" && (input.valueAmount ?? 0) > 0
      ? input.valueAmount!
      : 0;
  const alwaysUseDefault = input.valueType === "fixed" && valueDefault > 0;

  // 5) Push to Google.
  const customer = buildCustomerForAccount(account);
  let resourceName: string;
  try {
    const result = await customer.conversionActions.create([
      {
        name,
        category: categoryInt,
        status: enums.ConversionActionStatus.ENABLED,
        type: typeInt,
        counting_type: countingInt,
        click_through_lookback_window_days: 30,
        primary_for_goal: input.isPrimary,
        value_settings: {
          default_value: valueDefault,
          default_currency_code: account.currencyCode ?? "USD",
          always_use_default_value: alwaysUseDefault,
        },
      },
    ]);
    const rn = result.results[0]?.resource_name;
    if (!rn) {
      return { ok: false, error: "Google did not return a resource name." };
    }
    resourceName = rn;
  } catch (e) {
    return { ok: false, error: extractGoogleError(e) };
  }

  // 6) Extract numeric ID and mirror in our DB.
  const providerId = extractIdFromResourceName(resourceName);
  if (!providerId) {
    return {
      ok: false,
      error: `Created in Google but couldn't parse ID from "${resourceName}".`,
    };
  }

  const row = await db.conversionAction.create({
    data: {
      accountId: input.accountId,
      providerConversionId: providerId,
      name,
      category: input.category,
      status: "ENABLED",
      isPrimary: input.isPrimary,
      countingType: input.countingType,
      clickThroughLookbackDays: 30,
      valueMicros: alwaysUseDefault
        ? BigInt(Math.round(valueDefault * 1_000_000))
        : null,
      source: "created",
      tagInstalled: false,
    },
  });

  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: "conversion_action.create",
      targetKind: "conversion_action",
      targetId: row.id,
      payload: {
        providerConversionId: providerId,
        category: input.category,
        isPrimary: input.isPrimary,
        countingType: input.countingType,
        valueType: input.valueType,
        valueAmount: input.valueAmount ?? null,
      },
    },
  });

  return { ok: true, conversionActionId: row.id, providerId };
}

// ===========================================================================
// Status: pause / enable in Google + DB
// ===========================================================================

export async function setConversionActionStatus(opts: {
  conversionActionId: string;
  userId: string;
  newStatus: "ENABLED" | "PAUSED" | "REMOVED";
}): Promise<SetConversionStatusResult> {
  const action = await db.conversionAction.findFirst({
    where: { id: opts.conversionActionId },
    include: { account: true },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== opts.userId) {
    return { ok: false, error: "Not your conversion action." };
  }
  if (!action.providerConversionId) {
    return {
      ok: false,
      error: "This action was never created in Google — can't toggle.",
    };
  }

  // Google's ConversionActionStatus only has ENABLED / REMOVED / HIDDEN —
  // there's no PAUSED. We map PAUSED → HIDDEN (the customer's intent
  // "stop counting these for now without deleting the action"). REMOVED
  // is destructive and we expose it as a Pause+Remove combo elsewhere.
  const googleStatus =
    opts.newStatus === "REMOVED"
      ? enums.ConversionActionStatus.REMOVED
      : opts.newStatus === "PAUSED"
        ? enums.ConversionActionStatus.HIDDEN
        : enums.ConversionActionStatus.ENABLED;

  const customer = buildCustomerForAccount(action.account);
  const customerIdNum = action.account.customerId.replace(/-/g, "");
  const resourceName = `customers/${customerIdNum}/conversionActions/${action.providerConversionId}`;

  try {
    await customer.conversionActions.update([
      { resource_name: resourceName, status: googleStatus },
    ]);
  } catch (e) {
    return { ok: false, error: extractGoogleError(e) };
  }

  await db.conversionAction.update({
    where: { id: action.id },
    data: { status: opts.newStatus },
  });

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "conversion_action.status_change",
      targetKind: "conversion_action",
      targetId: action.id,
      payload: {
        previousStatus: action.status,
        newStatus: opts.newStatus,
        providerConversionId: action.providerConversionId,
      },
    },
  });

  return { ok: true, newStatus: opts.newStatus };
}

// ===========================================================================
// Primary flag — flip primary_for_goal
// ===========================================================================

export async function setConversionActionPrimary(opts: {
  conversionActionId: string;
  userId: string;
  isPrimary: boolean;
}): Promise<SetPrimaryResult> {
  const action = await db.conversionAction.findFirst({
    where: { id: opts.conversionActionId },
    include: { account: true },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== opts.userId) {
    return { ok: false, error: "Not your conversion action." };
  }
  if (!action.providerConversionId) {
    return {
      ok: false,
      error: "This action was never created in Google — can't toggle primary.",
    };
  }

  const customer = buildCustomerForAccount(action.account);
  const customerIdNum = action.account.customerId.replace(/-/g, "");
  const resourceName = `customers/${customerIdNum}/conversionActions/${action.providerConversionId}`;

  try {
    await customer.conversionActions.update([
      { resource_name: resourceName, primary_for_goal: opts.isPrimary },
    ]);
  } catch (e) {
    return { ok: false, error: extractGoogleError(e) };
  }

  await db.conversionAction.update({
    where: { id: action.id },
    data: { isPrimary: opts.isPrimary },
  });

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "conversion_action.primary_change",
      targetKind: "conversion_action",
      targetId: action.id,
      payload: {
        previousIsPrimary: action.isPrimary,
        newIsPrimary: opts.isPrimary,
      },
    },
  });

  return { ok: true, isPrimary: opts.isPrimary };
}

// ===========================================================================
// Tag-installed attestation — DB only, no Google call
// ===========================================================================

export async function setTagInstalled(opts: {
  conversionActionId: string;
  userId: string;
  installed: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const action = await db.conversionAction.findFirst({
    where: { id: opts.conversionActionId },
    include: { account: true },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== opts.userId) {
    return { ok: false, error: "Not your conversion action." };
  }
  await db.conversionAction.update({
    where: { id: action.id },
    data: { tagInstalled: opts.installed },
  });
  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "conversion_action.tag_installed",
      targetKind: "conversion_action",
      targetId: action.id,
      payload: { installed: opts.installed },
    },
  });
  return { ok: true };
}

// ===========================================================================
// GA4 — Phase B5. Create a Google Ads conversion action bound to a GA4
// event. The customer enters their GA4 property ID + property name +
// event name; Google handles the wiring (once Ads ↔ GA4 link is set
// up). The action's "fires" come from GA4 instead of a gtag snippet
// on the customer's site.
//
// Customer prerequisites (we surface these in the UI but can't verify
// directly without GA4 OAuth):
//   1. Their Google Ads account is linked to the GA4 property in
//      Admin → Linked accounts → Google Analytics.
//   2. The event the customer types exists in GA4 (we can't list them
//      without a separate GA4 OAuth scope — defer to Phase B5.1).
// ===========================================================================

export type CreateGa4ConversionInput = {
  accountId: string;
  userId: string;
  name: string;
  category: ConversionCategory;
  /// GA4 numeric property ID (the number from `properties/{id}` URLs).
  ga4PropertyId: string;
  /// Human-readable property name (e.g. "WeddingLens — Main Site").
  ga4PropertyName: string;
  /// The GA4 event name (e.g. "purchase", "generate_lead", custom).
  ga4EventName: string;
  /// One of:
  ///   - 'custom'        → ConversionActionType.GOOGLE_ANALYTICS_4_CUSTOM
  ///   - 'purchase'      → ...PURCHASE
  ///   - 'generate_lead' → ...GENERATE_LEAD
  ///   - 'qualify_lead'  → ...QUALIFY_LEAD
  ga4Kind: "custom" | "purchase" | "generate_lead" | "qualify_lead";
  countingType: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  isPrimary: boolean;
};

export async function createGa4ConversionAction(
  input: CreateGa4ConversionInput,
): Promise<CreateConversionResult> {
  const account = await db.adsAccount.findFirst({
    where: { id: input.accountId, userId: input.userId, demoMode: false },
  });
  if (!account) return { ok: false, error: "Account not found." };
  if (account.isManager) {
    return {
      ok: false,
      error: "Conversion actions can't be created on a manager account.",
    };
  }
  const name = input.name.trim().slice(0, 100);
  if (!name) return { ok: false, error: "Name is required." };
  if (!input.ga4PropertyId.trim() || !input.ga4EventName.trim()) {
    return {
      ok: false,
      error: "GA4 property ID and event name are required.",
    };
  }

  const ga4TypeInt =
    input.ga4Kind === "purchase"
      ? enums.ConversionActionType.GOOGLE_ANALYTICS_4_PURCHASE
      : input.ga4Kind === "generate_lead"
        ? enums.ConversionActionType.GOOGLE_ANALYTICS_4_GENERATE_LEAD
        : input.ga4Kind === "qualify_lead"
          ? enums.ConversionActionType.GOOGLE_ANALYTICS_4_QUALIFY_LEAD
          : enums.ConversionActionType.GOOGLE_ANALYTICS_4_CUSTOM;

  const categoryInt = mapCategoryToGoogle(input.category);
  const countingInt =
    input.countingType === "MANY_PER_CLICK"
      ? enums.ConversionActionCountingType.MANY_PER_CLICK
      : enums.ConversionActionCountingType.ONE_PER_CLICK;

  const customer = buildCustomerForAccount(account);
  let resourceName: string;
  try {
    const result = await customer.conversionActions.create([
      {
        name,
        category: categoryInt,
        status: enums.ConversionActionStatus.ENABLED,
        type: ga4TypeInt,
        counting_type: countingInt,
        click_through_lookback_window_days: 30,
        primary_for_goal: input.isPrimary,
        google_analytics_4_settings: {
          event_name: input.ga4EventName.trim(),
          property_name: input.ga4PropertyName.trim(),
          property_id: Number(input.ga4PropertyId.trim()) || 0,
        },
      },
    ]);
    const rn = result.results[0]?.resource_name;
    if (!rn) return { ok: false, error: "Google did not return a resource name." };
    resourceName = rn;
  } catch (e) {
    // GA4-linked ConversionAction types (GOOGLE_ANALYTICS_4_*) can't be
    // created via the Google Ads API — Google only allows creating them
    // through the Ads UI after linking Ads ↔ GA4. Surface a useful
    // instruction instead of the raw error.
    const raw = extractGoogleError(e);
    if (raw.toLowerCase().includes("isn't supported")) {
      return {
        ok: false,
        error:
          "Google Ads doesn't allow creating GA4-linked conversion actions via API — must be created in the Google Ads UI. " +
          "Real path that works in 2026: " +
          "1) Google Ads → Tools → Conversions → Goals → Summary → + New conversion action. " +
          "2) Pick 'Conversion on a website' → enter your site URL → Google scans the page. " +
          `3) If your GA4 tag is detected on scan, pick the 'Import GA4 events' option, then pick property '${input.ga4PropertyName}' (${input.ga4PropertyId}) and event '${input.ga4EventName}'. ` +
          "4) Save in Google Ads. Click 'Import now' on the account detail page in our app — the new action will appear in this hub. " +
          "(If the scan doesn't detect GA4, confirm the property is linked in Tools → Data Manager → Connected Products, and that at least one event is marked as a Key event in GA4 → Admin → Events.)",
      };
    }
    return { ok: false, error: raw };
  }

  const providerId = extractIdFromResourceName(resourceName);
  if (!providerId) {
    return {
      ok: false,
      error: `Created in Google but couldn't parse ID from "${resourceName}".`,
    };
  }

  const row = await db.conversionAction.create({
    data: {
      accountId: input.accountId,
      providerConversionId: providerId,
      name,
      category: input.category,
      status: "ENABLED",
      isPrimary: input.isPrimary,
      countingType: input.countingType,
      clickThroughLookbackDays: 30,
      source: "created",
      tagInstalled: true, // GA4 fires from the customer's existing GA4 setup
    },
  });

  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: "conversion_action.create_ga4",
      targetKind: "conversion_action",
      targetId: row.id,
      payload: {
        providerConversionId: providerId,
        ga4PropertyId: input.ga4PropertyId,
        ga4EventName: input.ga4EventName,
        ga4Kind: input.ga4Kind,
        category: input.category,
      },
    },
  });

  return { ok: true, conversionActionId: row.id, providerId };
}

// ===========================================================================
// Check-fire — Phase B4. Query Google directly for this conversion
// action's recent fire count + last-fire timestamp. Used by the
// per-row "Check status" button so the customer doesn't have to wait
// for the daily sync to know whether their snippet is working.
// ===========================================================================

export async function checkConversionFire(opts: {
  conversionActionId: string;
  userId: string;
  windowDays?: number;
}): Promise<CheckFireResult> {
  const windowDays = opts.windowDays ?? 7;
  if (windowDays < 1 || windowDays > 90) {
    return { ok: false, error: "windowDays must be 1-90." };
  }

  const action = await db.conversionAction.findFirst({
    where: { id: opts.conversionActionId },
    include: { account: true },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== opts.userId) {
    return { ok: false, error: "Not your conversion action." };
  }
  if (!action.providerConversionId) {
    return {
      ok: false,
      error: "This action was never created in Google — no stats to fetch.",
    };
  }

  const customer = buildCustomerForAccount(action.account);
  type Row = {
    metrics?: { all_conversions?: number | null };
    segments?: { date?: string | null };
  };

  // Pull per-day rows so we can compute lastFireAt accurately.
  let rows: Row[];
  try {
    rows = (await customer.query(`
      SELECT
        metrics.all_conversions,
        segments.date
      FROM conversion_action
      WHERE conversion_action.id = ${action.providerConversionId}
        AND segments.date DURING LAST_${windowDays === 7 ? "7" : windowDays === 30 ? "30" : "14"}_DAYS
    `)) as unknown as Row[];
  } catch (e) {
    // The DURING clause only accepts LAST_7_DAYS / LAST_14_DAYS /
    // LAST_30_DAYS literals. Fall back to a date range for arbitrary
    // windowDays.
    try {
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      const sinceStr = since.toISOString().slice(0, 10);
      rows = (await customer.query(`
        SELECT
          metrics.all_conversions,
          segments.date
        FROM conversion_action
        WHERE conversion_action.id = ${action.providerConversionId}
          AND segments.date >= '${sinceStr}'
      `)) as unknown as Row[];
    } catch (e2) {
      return { ok: false, error: extractGoogleError(e2) || extractGoogleError(e) };
    }
  }

  let total = 0;
  let lastFireAt: Date | null = null;
  for (const r of rows) {
    const c = r.metrics?.all_conversions ?? 0;
    if (c > 0) {
      total += c;
      const d = r.segments?.date;
      if (d) {
        const parsed = new Date(`${d}T00:00:00Z`);
        if (!Number.isNaN(parsed.getTime())) {
          if (!lastFireAt || parsed.getTime() > lastFireAt.getTime()) {
            lastFireAt = parsed;
          }
        }
      }
    }
  }

  // Mirror the freshest info into our DB so health.ts picks it up
  // without waiting for the daily sync.
  await db.conversionAction.update({
    where: { id: action.id },
    data: {
      lastConversionAt: lastFireAt ?? action.lastConversionAt,
      recentConversions: Math.round(total),
    },
  });

  return {
    ok: true,
    recentCount: total,
    lastFireAt,
    windowDays,
  };
}

// ===========================================================================
// Tag snippets from Google — Phase B5.2
//
// Replaces the YOUR_CONVERSION_LABEL placeholder with the real, fully-
// formed gtag event snippet that Google generates for this conversion
// action. Pulled via GAQL: `SELECT conversion_action.tag_snippets`.
//
// Each row in `tag_snippets` corresponds to one (type × page_format)
// combination — WEBPAGE × HTML, WEBPAGE × AMP, etc. We pick the
// WEBPAGE/HTML one (the gtag-based snippet) and parse out the bits
// the customer actually needs.
// ===========================================================================

export type FetchedTagSnippet = {
  ok: true;
  baseTag: string;
  eventSnippet: string;
  /// The send_to value embedded in the event snippet (e.g. AW-12345/AbC...).
  sendTo: string | null;
};

export type FetchTagSnippetsResult =
  | FetchedTagSnippet
  | { ok: false; error: string };

export async function fetchTagSnippetsFromGoogle(opts: {
  conversionActionId: string;
  userId: string;
}): Promise<FetchTagSnippetsResult> {
  const action = await db.conversionAction.findFirst({
    where: { id: opts.conversionActionId },
    include: { account: true },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== opts.userId) {
    return { ok: false, error: "Not your conversion action." };
  }
  if (!action.providerConversionId) {
    return {
      ok: false,
      error: "This action was never created in Google.",
    };
  }
  const customer = buildCustomerForAccount(action.account);
  type Row = {
    conversion_action?: {
      tag_snippets?: Array<{
        type?: string | number;
        page_format?: string | number;
        global_site_tag?: string;
        event_snippet?: string;
      }>;
    };
  };
  let rows: Row[];
  try {
    rows = (await customer.query(`
      SELECT conversion_action.tag_snippets
      FROM conversion_action
      WHERE conversion_action.id = ${action.providerConversionId}
      LIMIT 1
    `)) as unknown as Row[];
  } catch (e) {
    return { ok: false, error: extractGoogleError(e) };
  }
  const snippets = rows[0]?.conversion_action?.tag_snippets ?? [];
  if (snippets.length === 0) {
    return {
      ok: false,
      error:
        "Google returned no tag snippets for this action. It may be a GA4-linked or call-based action that doesn't have a website snippet.",
    };
  }
  // Prefer the WEBPAGE / HTML snippet. type/page_format may come back
  // as int (enum) or string. Match either:
  //   type=WEBPAGE (enums.TrackingCodeType.WEBPAGE = 2)
  //   page_format=HTML (enums.TrackingCodePageFormat.HTML = 2)
  const preferred =
    snippets.find(
      (s) =>
        (s.type === "WEBPAGE" || s.type === 2) &&
        (s.page_format === "HTML" || s.page_format === 2),
    ) ?? snippets[0]!;

  const baseTag = preferred.global_site_tag ?? "";
  const eventSnippet = preferred.event_snippet ?? "";
  // Extract send_to from the event snippet — it's the value in
  // `'send_to': 'AW-X/Y'`.
  const m = eventSnippet.match(/['"]send_to['"]\s*:\s*['"]([^'"]+)['"]/);
  return {
    ok: true,
    baseTag,
    eventSnippet,
    sendTo: m?.[1] ?? null,
  };
}

// ===========================================================================
// Snippet rendering — gtag.js + GTM trigger config
// ===========================================================================

export type GtagSnippets = {
  awId: string;                  // 'AW-1234567890'
  sendTo: string;                // 'AW-1234567890/conversion_label_or_id'
  baseTag: string;               // <script> for global site tag
  eventTag: string;              // <script> firing the conversion event
  noScriptImg: string;           // fallback <noscript><img/></noscript>
  gtmTrigger: string;            // copy-pasteable JSON for GTM "Google Ads
                                 // Conversion Tracking" tag config
};

export function buildGtagSnippets(args: {
  customerId: string;
  providerConversionId: string | null;
  valueAmount?: number | null;   // USD
  currencyCode?: string | null;
}): GtagSnippets {
  const awId = `AW-${args.customerId.replace(/-/g, "")}`;
  // Google's TagSnippetService would return the per-action label here.
  // We fall back to the conversion ID itself — Google's gtag accepts
  // either `send_to: 'AW-X/<label>'` OR the raw conversion ID URL
  // form. The customer can paste the label later if they fetched it
  // from the Google Ads UI.
  const tail = args.providerConversionId ?? "YOUR_CONVERSION_LABEL";
  const sendTo = `${awId}/${tail}`;
  const value = args.valueAmount ?? 1.0;
  const currency = args.currencyCode ?? "USD";

  const baseTag = `<!-- Google site tag (gtag.js) — Google Ads -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${awId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${awId}');
</script>`;

  const eventTag = `<!-- Fire on the page that represents the conversion -->
<script>
  gtag('event', 'conversion', {
    'send_to': '${sendTo}',
    'value': ${value.toFixed(2)},
    'currency': '${currency}'
  });
</script>`;

  const noScriptImg = `<noscript>
  <img src="https://www.googleadservices.com/pagead/conversion/${args.customerId.replace(/-/g, "")}/?label=${args.providerConversionId ?? "YOUR_LABEL"}&amp;guid=ON&amp;script=0" />
</noscript>`;

  const gtmTrigger = JSON.stringify(
    {
      tag: "Google Ads Conversion Tracking",
      conversionId: args.customerId.replace(/-/g, ""),
      conversionLabel: args.providerConversionId ?? "YOUR_CONVERSION_LABEL",
      conversionValue: value,
      currencyCode: currency,
      triggerWhen: "Form submit / Thank-you page view / Button click",
    },
    null,
    2,
  );

  return { awId, sendTo, baseTag, eventTag, noScriptImg, gtmTrigger };
}

// ===========================================================================
// Helpers
// ===========================================================================

function extractIdFromResourceName(rn: string): string | null {
  // 'customers/1234567890/conversionActions/987654321' → '987654321'
  const parts = rn.split("/");
  return parts[parts.length - 1] ?? null;
}

function mapCategoryToGoogle(c: ConversionCategory): number {
  // Our enum is a strict subset of Google's. Map each safely; fall back
  // to DEFAULT for anything we don't explicitly know (OTHER).
  switch (c) {
    case "PAGE_VIEW":
      return enums.ConversionActionCategory.PAGE_VIEW;
    case "PURCHASE":
      return enums.ConversionActionCategory.PURCHASE;
    case "SIGNUP":
      return enums.ConversionActionCategory.SIGNUP;
    case "LEAD":
      // Google removed the bare LEAD category in v17+. Closest match
      // for a generic lead form is SUBMIT_LEAD_FORM.
      return enums.ConversionActionCategory.SUBMIT_LEAD_FORM;
    case "DOWNLOAD":
      return enums.ConversionActionCategory.DOWNLOAD;
    case "STORE_VISIT":
      return enums.ConversionActionCategory.STORE_VISIT;
    case "STORE_SALE":
      return enums.ConversionActionCategory.STORE_SALE;
    case "PHONE_CALL_LEAD":
      return enums.ConversionActionCategory.PHONE_CALL_LEAD;
    case "IMPORTED_LEAD":
      return enums.ConversionActionCategory.IMPORTED_LEAD;
    case "SUBMIT_LEAD_FORM":
      return enums.ConversionActionCategory.SUBMIT_LEAD_FORM;
    case "BOOK_APPOINTMENT":
      return enums.ConversionActionCategory.BOOK_APPOINTMENT;
    case "REQUEST_QUOTE":
      return enums.ConversionActionCategory.REQUEST_QUOTE;
    case "ADD_TO_CART":
      return enums.ConversionActionCategory.ADD_TO_CART;
    case "BEGIN_CHECKOUT":
      return enums.ConversionActionCategory.BEGIN_CHECKOUT;
    case "SUBSCRIBE_PAID":
      return enums.ConversionActionCategory.SUBSCRIBE_PAID;
    case "CONTACT":
      return enums.ConversionActionCategory.CONTACT;
    case "GET_DIRECTIONS":
      return enums.ConversionActionCategory.GET_DIRECTIONS;
    case "OTHER":
    default:
      return enums.ConversionActionCategory.DEFAULT;
  }
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
      return "[unserializable error]";
    }
  }
  return String(e);
}
