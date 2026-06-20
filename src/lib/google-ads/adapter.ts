/**
 * Google Ads SEARCH adapter — port of
 * adwords-benchmarks/src/launcher/providers/google_ads/adapter.py.
 *
 * Pushes a complete SEARCH campaign to Google Ads via six sequential
 * mutate calls:
 *
 *   1. CampaignBudget   — daily budget
 *   2. Campaign         — references the budget, status PAUSED-on-Google,
 *                         bidding strategy (target_spend / target_cpa /
 *                         maximize_conversions), EU political ad opt-out
 *   3. AdGroup          — references the campaign
 *   4. AdGroupAd        — Responsive Search Ad with headlines + descriptions
 *   5. AdGroupCriterion — positive + negative keywords (batched)
 *   6. CampaignCriterion — geo targets (one per resolved geo constant)
 *
 * The Opteo `google-ads-api` package uses snake_case for proto fields,
 * matching the API spec — so the field names look identical to Python.
 *
 * Hard safety: every campaign is PAUSED on Google regardless of the
 * payload's `launch_status`. Operators flip to Enabled from Google's UI.
 */
import { enums, type Customer } from "google-ads-api";

import type { SearchLaunchPayload } from "@/lib/wizard/payload-builder";

import { resolveGeo } from "./geo";

export type LaunchResult = {
  /** Numeric campaign ID Google assigned (e.g. "23939027255"). */
  providerCampaignId: string;
  /** Full resource name (customers/X/campaigns/Y). */
  resourceName: string;
  /** Always "PAUSED" — safety hardcoded. */
  status: "PAUSED";
  /** Human-readable summary of what got pushed. Audit + UI display. */
  operations: OperationSummary[];
};

export type OperationSummary = {
  type: string;
  detail: Record<string, unknown>;
};

export async function launchSearchCampaign(args: {
  customer: Customer;
  payload: SearchLaunchPayload;
}): Promise<LaunchResult> {
  const { customer, payload } = args;

  // 0. Geo resolution first — fails fast if cities can't be looked up.
  const geoConstants = await resolveGeo(payload.geo, customer);

  // 1. Budget
  const budgetResourceName = await createBudget(customer, payload);
  // 2. Campaign
  const campaignResourceName = await createCampaign(
    customer,
    payload,
    budgetResourceName,
  );
  const campaignId = campaignResourceName.split("/").pop()!;

  // 3-5. Ad groups + ads + keywords. Two branches:
  //   • payload.ad_groups present → Phase A5 multi-ad-group flow
  //   • otherwise                 → legacy single-ad-group flow
  let adGroupCount = 1;
  if (payload.ad_groups && payload.ad_groups.length > 0) {
    adGroupCount = payload.ad_groups.length;
    for (const cluster of payload.ad_groups) {
      const agRn = await createAdGroupNamed({
        customer,
        payload,
        campaignResourceName,
        nameSuffix: cluster.theme_label,
      });
      await createResponsiveSearchAdFor({
        customer,
        adGroupResourceName: agRn,
        finalUrl: payload.book.landing_page_url,
        headlines: cluster.headlines,
        descriptions: cluster.descriptions,
      });
      await createKeywordsFor({
        customer,
        adGroupResourceName: agRn,
        positive: cluster.keywords,
        negative: cluster.negative_keywords ?? [],
      });
    }
  } else {
    // Legacy single-ad-group flow — unchanged
    const adGroupResourceName = await createAdGroup(
      customer,
      payload,
      campaignResourceName,
    );
    await createResponsiveSearchAd(customer, payload, adGroupResourceName);
    await createKeywords(customer, payload, adGroupResourceName);
  }

  // 6. Geo criteria
  await createGeoCriteria(customer, campaignResourceName, geoConstants);

  return {
    providerCampaignId: campaignId,
    resourceName: campaignResourceName,
    status: "PAUSED",
    operations: summarize(payload, geoConstants.length, adGroupCount),
  };
}

// ---------------------------------------------------------------------------
// 3b. Named ad group (Phase A5) — version that takes a cluster name
// suffix so each cluster gets its own AdGroup like
// "Ikigai · Branded AdGroup".
// ---------------------------------------------------------------------------
async function createAdGroupNamed(args: {
  customer: Customer;
  payload: SearchLaunchPayload;
  campaignResourceName: string;
  nameSuffix: string;
}): Promise<string> {
  const { customer, payload, campaignResourceName, nameSuffix } = args;
  const title = (payload.book.title || "Untitled").slice(0, 30);
  const cpcMicros = Math.round(
    (payload.budget.max_cpc_usd ?? 1.0) * 1_000_000,
  );
  const safeSuffix = nameSuffix.slice(0, 30).replace(/[^\w\s\-·]/g, "");
  const result = await customer.adGroups.create([
    {
      name: `${title} · ${safeSuffix}`.slice(0, 60),
      campaign: campaignResourceName,
      status: enums.AdGroupStatus.ENABLED,
      type: enums.AdGroupType.SEARCH_STANDARD,
      cpc_bid_micros: cpcMicros,
    },
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create AdGroup");
  return rn;
}

// ---------------------------------------------------------------------------
// 4b. RSA for a specific cluster (takes inline copy instead of pulling
// from the global payload.ad_copy).
// ---------------------------------------------------------------------------
async function createResponsiveSearchAdFor(args: {
  customer: Customer;
  adGroupResourceName: string;
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
}): Promise<string> {
  const { customer, adGroupResourceName, finalUrl } = args;
  const headlines = args.headlines
    .slice(0, 15)
    .map((text) => ({ text: text.slice(0, 30) }));
  const descriptions = args.descriptions
    .slice(0, 4)
    .map((text) => ({ text: text.slice(0, 90) }));
  const result = await customer.adGroupAds.create([
    {
      ad_group: adGroupResourceName,
      status: enums.AdGroupAdStatus.ENABLED,
      ad: {
        final_urls: [finalUrl],
        responsive_search_ad: { headlines, descriptions },
      },
    },
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create ResponsiveSearchAd");
  return rn;
}

// ---------------------------------------------------------------------------
// 5b. Keywords for a specific cluster (takes inline positive + negative
// lists). One batched mutate per cluster.
// ---------------------------------------------------------------------------
async function createKeywordsFor(args: {
  customer: Customer;
  adGroupResourceName: string;
  positive: string[];
  negative: string[];
}): Promise<void> {
  const positive = args.positive.map((kw) => ({
    ad_group: args.adGroupResourceName,
    status: enums.AdGroupCriterionStatus.ENABLED,
    keyword: { text: kw, match_type: enums.KeywordMatchType.BROAD },
  }));
  const negative = args.negative.map((kw) => ({
    ad_group: args.adGroupResourceName,
    status: enums.AdGroupCriterionStatus.ENABLED,
    negative: true,
    keyword: { text: kw, match_type: enums.KeywordMatchType.BROAD },
  }));
  const all = [...positive, ...negative];
  if (all.length === 0) return;
  await args.customer.adGroupCriteria.create(all);
}

// ---------------------------------------------------------------------------
// 1. Budget
// ---------------------------------------------------------------------------
async function createBudget(
  customer: Customer,
  payload: SearchLaunchPayload,
): Promise<string> {
  const namePrefix = (payload.book.title || "Campaign").slice(0, 40);
  const result = await customer.campaignBudgets.create([
    {
      name: `${namePrefix} Budget ${randomToken(3)}`,
      amount_micros: Math.round(payload.budget.daily_usd * 1_000_000),
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
    },
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create CampaignBudget");
  return rn;
}

// ---------------------------------------------------------------------------
// 2. Campaign
// ---------------------------------------------------------------------------
async function createCampaign(
  customer: Customer,
  payload: SearchLaunchPayload,
  budgetResourceName: string,
): Promise<string> {
  const title = (payload.book.title || "Untitled").slice(0, 60);

  // Build the bidding-strategy oneof. The proto exposes ONE field at a
  // time on Campaign; setting target_spend / maximize_conversions /
  // target_cpa selects the strategy.
  //
  // Gotcha: "Maximize Clicks" is exposed as `target_spend` (legacy proto
  // name). Don't try to set `maximize_clicks` — it doesn't exist.
  const biddingFields: Record<string, unknown> = {};
  switch (payload.budget.bidding_strategy) {
    case "MAXIMIZE_CLICKS":
      biddingFields.target_spend = {
        ...(payload.budget.max_cpc_usd != null
          ? {
              cpc_bid_ceiling_micros: Math.round(
                payload.budget.max_cpc_usd * 1_000_000,
              ),
            }
          : {}),
      };
      break;
    case "MAXIMIZE_CONVERSIONS":
      biddingFields.maximize_conversions = {};
      break;
    case "TARGET_CPA":
      biddingFields.target_cpa = {
        target_cpa_micros: Math.round(
          (payload.budget.target_cpa_usd ?? 0) * 1_000_000,
        ),
      };
      break;
    default:
      throw new Error(
        `Unsupported bidding strategy: ${String(payload.budget.bidding_strategy)}`,
      );
  }

  const result = await customer.campaigns.create([
    {
      name: `${title} — SEARCH`,
      campaign_budget: budgetResourceName,
      advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
      // SAFETY: PAUSED-on-Google regardless of payload.launch_status.
      status: enums.CampaignStatus.PAUSED,
      // Required since 2024 — every campaign must self-declare EU
      // political-ad status. Book promotions never qualify.
      contains_eu_political_advertising:
        enums.EuPoliticalAdvertisingStatus
          .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
      network_settings: {
        target_google_search: true,
        target_search_network: true,
        target_content_network: false,
        target_partner_search_network: false,
      },
      ...biddingFields,
    } as Parameters<typeof customer.campaigns.create>[0][number],
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create Campaign");
  return rn;
}

// ---------------------------------------------------------------------------
// 3. Ad group
// ---------------------------------------------------------------------------
async function createAdGroup(
  customer: Customer,
  payload: SearchLaunchPayload,
  campaignResourceName: string,
): Promise<string> {
  const title = (payload.book.title || "Untitled").slice(0, 40);
  const cpcMicros = Math.round(
    (payload.budget.max_cpc_usd ?? 1.0) * 1_000_000,
  );
  const result = await customer.adGroups.create([
    {
      name: `${title} AdGroup`,
      campaign: campaignResourceName,
      status: enums.AdGroupStatus.ENABLED,
      type: enums.AdGroupType.SEARCH_STANDARD,
      cpc_bid_micros: cpcMicros,
    },
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create AdGroup");
  return rn;
}

// ---------------------------------------------------------------------------
// 4. Responsive Search Ad
// ---------------------------------------------------------------------------
async function createResponsiveSearchAd(
  customer: Customer,
  payload: SearchLaunchPayload,
  adGroupResourceName: string,
): Promise<string> {
  const headlines = payload.ad_copy.headlines
    .slice(0, 15)
    .map((text) => ({ text: text.slice(0, 30) }));
  const descriptions = payload.ad_copy.descriptions
    .slice(0, 4)
    .map((text) => ({ text: text.slice(0, 90) }));

  const result = await customer.adGroupAds.create([
    {
      ad_group: adGroupResourceName,
      status: enums.AdGroupAdStatus.ENABLED,
      ad: {
        final_urls: [payload.book.landing_page_url],
        responsive_search_ad: { headlines, descriptions },
      },
    },
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create ResponsiveSearchAd");
  return rn;
}

// ---------------------------------------------------------------------------
// 5. Keywords
// ---------------------------------------------------------------------------
async function createKeywords(
  customer: Customer,
  payload: SearchLaunchPayload,
  adGroupResourceName: string,
): Promise<void> {
  const positive = payload.ad_copy.keywords.map((kw) => ({
    ad_group: adGroupResourceName,
    status: enums.AdGroupCriterionStatus.ENABLED,
    keyword: {
      text: kw,
      match_type: enums.KeywordMatchType.BROAD,
    },
  }));
  const negative = (payload.ad_copy.negative_keywords ?? []).map((kw) => ({
    ad_group: adGroupResourceName,
    status: enums.AdGroupCriterionStatus.ENABLED,
    negative: true,
    keyword: {
      text: kw,
      match_type: enums.KeywordMatchType.BROAD,
    },
  }));
  const all = [...positive, ...negative];
  if (all.length === 0) return;
  await customer.adGroupCriteria.create(all);
}

// ---------------------------------------------------------------------------
// 6. Geo criteria
// ---------------------------------------------------------------------------
async function createGeoCriteria(
  customer: Customer,
  campaignResourceName: string,
  geoConstants: string[],
): Promise<void> {
  if (geoConstants.length === 0) return;
  await customer.campaignCriteria.create(
    geoConstants.map((geoConst) => ({
      campaign: campaignResourceName,
      location: { geo_target_constant: geoConst },
    })),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomToken(bytes: number): string {
  // Suffix to make budget names unique (Google rejects duplicates per
  // account). Crypto-strength not required.
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < bytes * 2; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function summarize(
  payload: SearchLaunchPayload,
  geoCount: number,
  adGroupCount: number = 1,
): OperationSummary[] {
  return [
    { type: "CampaignBudget", detail: { daily_usd: payload.budget.daily_usd } },
    {
      type: "Campaign",
      detail: {
        name: payload.book.title,
        channel: payload.channel,
        status: "PAUSED",
        bidding: payload.budget.bidding_strategy,
      },
    },
    {
      type: "AdGroup",
      detail: {
        count: adGroupCount,
        labels:
          payload.ad_groups?.map((g) => g.theme_label) ?? [payload.book.title],
      },
    },
    {
      type: "ResponsiveSearchAd",
      detail: {
        headlines: payload.ad_copy.headlines.length,
        descriptions: payload.ad_copy.descriptions.length,
        final_url: payload.book.landing_page_url,
      },
    },
    {
      type: "Keywords",
      detail: {
        positive: payload.ad_copy.keywords.length,
        negative: payload.ad_copy.negative_keywords?.length ?? 0,
      },
    },
    {
      type: "GeoCriteria",
      detail: {
        scope: payload.geo.scope,
        country: payload.geo.country,
        resolved_count: geoCount,
      },
    },
  ];
}
