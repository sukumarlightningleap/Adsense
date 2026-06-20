/**
 * Structured launch payload — the JSON the Google Ads launcher consumes.
 *
 * The YAML built by `yaml-builder.ts` is for HUMAN display only. The
 * launcher reads this structured payload from `Campaign.payloadJson` so
 * we never have to parse YAML at launch time.
 *
 * Channel-aware: SEARCH and PMAX produce different shapes for ad copy +
 * budget. The launcher branches on the `channel` discriminator.
 */
import type { CampaignDraft } from "./schema";

type SharedFields = {
  launch_status: "PAUSED";
  book: {
    title: string;
    isbn?: string;
    landing_page_url: string;
    description: string;
  };
  geo: {
    country: string;
    scope: "nationwide" | "top_metros" | "specific_cities";
    cities?: string[];
  };
};

export type SearchLaunchPayload = SharedFields & {
  channel: "SEARCH";
  budget: {
    daily_usd: number;
    bidding_strategy: "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS" | "TARGET_CPA";
    max_cpc_usd?: number;
    target_cpa_usd?: number;
  };
  /**
   * Legacy single-ad-group copy. Always present so older campaigns +
   * the wizard path keep working. When `ad_groups` is also present,
   * the adapter prefers the multi-ad-group flow and ignores this.
   */
  ad_copy: {
    headlines: string[];
    descriptions: string[];
    keywords: string[];
    negative_keywords?: string[];
  };
  /**
   * Multi-ad-group copy (Phase A5). One entry per ad group — the
   * adapter creates a named AdGroup + RSA + keyword set for each.
   */
  ad_groups?: Array<{
    theme_label: string;
    intent?: string;
    headlines: string[];
    descriptions: string[];
    keywords: string[];
    negative_keywords?: string[];
  }>;
};

export type PmaxLaunchPayload = SharedFields & {
  channel: "PMAX";
  budget: {
    daily_usd: number;
    bidding_strategy:
      | "MAXIMIZE_CONVERSIONS"
      | "MAXIMIZE_CONVERSION_VALUE"
      | "TARGET_CPA"
      | "TARGET_ROAS";
    target_cpa_usd?: number;
    target_roas?: number;
  };
  /**
   * Legacy single-asset-group copy. Always populated for backward compat;
   * when `asset_groups` is also present the adapter prefers the multi-
   * asset-group flow and uses this only as a fallback (cluster #0).
   */
  ad_copy: {
    headlines: string[]; // short, ≤30
    long_headlines: string[]; // ≤90
    descriptions: string[]; // ≤90
    business_name: string; // ≤25
  };
  /**
   * Multi-asset-group copy (Phase A5). One entry per asset group — the
   * PMAX adapter creates a named AssetGroup + its text-asset links for
   * each. Image assets are shared across all groups.
   */
  asset_groups?: Array<{
    theme_label: string;
    intent?: string;
    headlines: string[];
    long_headlines: string[];
    descriptions: string[];
    business_name: string;
  }>;
  assets?: {
    logo_asset_id?: string;
    landscape_logo_asset_id?: string;
    marketing_image_asset_id?: string;
    square_marketing_image_asset_id?: string;
    portrait_marketing_image_asset_id?: string;
  };
};

export type LaunchPayload = SearchLaunchPayload | PmaxLaunchPayload;

export function buildLaunchPayload(draft: CampaignDraft): LaunchPayload {
  const shared: SharedFields = {
    launch_status: "PAUSED",
    book: {
      title: draft.book.title,
      ...(draft.book.isbn ? { isbn: draft.book.isbn } : {}),
      landing_page_url: draft.book.landingPageUrl,
      description: draft.book.description,
    },
    geo: {
      country: draft.audience.country,
      scope: draft.audience.scope,
      ...(draft.audience.scope === "specific_cities" &&
      draft.audience.cities &&
      draft.audience.cities.length > 0
        ? { cities: draft.audience.cities }
        : {}),
    },
  };

  if (draft.channel === "SEARCH") {
    const b = draft.searchBudget!;
    const c = draft.searchAdCopy;
    const groups = draft.searchAdGroups;

    // Resolve a "legacy" single-ad-group fallback for `ad_copy` so the
    // shape is always present (older campaigns + the adapter's
    // backward-compat branch read from it). If only multi-ad-group
    // data is supplied, flatten the first cluster into ad_copy.
    const firstGroup = groups?.[0];
    const legacyAdCopy = c
      ? {
          headlines: c.headlines,
          descriptions: c.descriptions,
          keywords: c.keywords,
          ...(c.negativeKeywords && c.negativeKeywords.length > 0
            ? { negative_keywords: c.negativeKeywords }
            : {}),
        }
      : firstGroup
        ? {
            headlines: firstGroup.headlines,
            descriptions: firstGroup.descriptions,
            keywords: firstGroup.keywords,
            ...(firstGroup.negativeKeywords &&
            firstGroup.negativeKeywords.length > 0
              ? { negative_keywords: firstGroup.negativeKeywords }
              : {}),
          }
        : { headlines: [], descriptions: [], keywords: [] };

    return {
      ...shared,
      channel: "SEARCH",
      budget: {
        daily_usd: b.dailyUsd,
        bidding_strategy: b.biddingStrategy,
        ...(b.maxCpcUsd != null ? { max_cpc_usd: b.maxCpcUsd } : {}),
        ...(b.targetCpaUsd != null ? { target_cpa_usd: b.targetCpaUsd } : {}),
      },
      ad_copy: legacyAdCopy,
      ...(groups && groups.length > 0
        ? {
            ad_groups: groups.map((g) => ({
              theme_label: g.themeLabel,
              ...(g.intent ? { intent: g.intent } : {}),
              headlines: g.headlines,
              descriptions: g.descriptions,
              keywords: g.keywords,
              ...(g.negativeKeywords && g.negativeKeywords.length > 0
                ? { negative_keywords: g.negativeKeywords }
                : {}),
            })),
          }
        : {}),
    };
  }

  // PMAX
  const b = draft.pmaxBudget!;
  const c = draft.pmaxAdCopy;
  const groups = draft.pmaxAssetGroups;
  const a = draft.pmaxAssets;

  // Resolve legacy single-group `ad_copy` from the first cluster when
  // only multi-asset-group data is supplied — keeps older adapter code
  // paths + audit logs / KPI displays consistent.
  const firstGroup = groups?.[0];
  const legacyAdCopy = c
    ? {
        headlines: c.headlines,
        long_headlines: c.longHeadlines,
        descriptions: c.descriptions,
        business_name: c.businessName,
      }
    : firstGroup
      ? {
          headlines: firstGroup.headlines,
          long_headlines: firstGroup.longHeadlines,
          descriptions: firstGroup.descriptions,
          business_name: firstGroup.businessName,
        }
      : {
          headlines: [],
          long_headlines: [],
          descriptions: [],
          business_name: "",
        };

  return {
    ...shared,
    channel: "PMAX",
    budget: {
      daily_usd: b.dailyUsd,
      bidding_strategy: b.biddingStrategy,
      ...(b.targetCpaUsd != null ? { target_cpa_usd: b.targetCpaUsd } : {}),
      ...(b.targetRoas != null ? { target_roas: b.targetRoas } : {}),
    },
    ad_copy: legacyAdCopy,
    ...(groups && groups.length > 0
      ? {
          asset_groups: groups.map((g) => ({
            theme_label: g.themeLabel,
            ...(g.intent ? { intent: g.intent } : {}),
            headlines: g.headlines,
            long_headlines: g.longHeadlines,
            descriptions: g.descriptions,
            business_name: g.businessName,
          })),
        }
      : {}),
    ...(a && Object.values(a).some(Boolean)
      ? {
          assets: {
            ...(a.logoAssetId ? { logo_asset_id: a.logoAssetId } : {}),
            ...(a.landscapeLogoAssetId
              ? { landscape_logo_asset_id: a.landscapeLogoAssetId }
              : {}),
            ...(a.marketingImageAssetId
              ? { marketing_image_asset_id: a.marketingImageAssetId }
              : {}),
            ...(a.squareMarketingImageAssetId
              ? {
                  square_marketing_image_asset_id:
                    a.squareMarketingImageAssetId,
                }
              : {}),
            ...(a.portraitMarketingImageAssetId
              ? {
                  portrait_marketing_image_asset_id:
                    a.portraitMarketingImageAssetId,
                }
              : {}),
          },
        }
      : {}),
  };
}
