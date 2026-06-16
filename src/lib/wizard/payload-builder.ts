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
  ad_copy: {
    headlines: string[];
    descriptions: string[];
    keywords: string[];
    negative_keywords?: string[];
  };
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
  ad_copy: {
    headlines: string[]; // short, ≤30
    long_headlines: string[]; // ≤90
    descriptions: string[]; // ≤90
    business_name: string; // ≤25
  };
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
    const c = draft.searchAdCopy!;
    return {
      ...shared,
      channel: "SEARCH",
      budget: {
        daily_usd: b.dailyUsd,
        bidding_strategy: b.biddingStrategy,
        ...(b.maxCpcUsd != null ? { max_cpc_usd: b.maxCpcUsd } : {}),
        ...(b.targetCpaUsd != null ? { target_cpa_usd: b.targetCpaUsd } : {}),
      },
      ad_copy: {
        headlines: c.headlines,
        descriptions: c.descriptions,
        keywords: c.keywords,
        ...(c.negativeKeywords && c.negativeKeywords.length > 0
          ? { negative_keywords: c.negativeKeywords }
          : {}),
      },
    };
  }

  // PMAX
  const b = draft.pmaxBudget!;
  const c = draft.pmaxAdCopy!;
  const a = draft.pmaxAssets;
  return {
    ...shared,
    channel: "PMAX",
    budget: {
      daily_usd: b.dailyUsd,
      bidding_strategy: b.biddingStrategy,
      ...(b.targetCpaUsd != null ? { target_cpa_usd: b.targetCpaUsd } : {}),
      ...(b.targetRoas != null ? { target_roas: b.targetRoas } : {}),
    },
    ad_copy: {
      headlines: c.headlines,
      long_headlines: c.longHeadlines,
      descriptions: c.descriptions,
      business_name: c.businessName,
    },
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
