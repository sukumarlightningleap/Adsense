/**
 * Structured launch payload — the JSON the Google Ads launcher consumes.
 *
 * The YAML built by `yaml-builder.ts` is for HUMAN display only. The
 * launcher reads this structured payload from `Campaign.payloadJson` so
 * we never have to parse YAML at launch time.
 */
import type { CampaignDraft } from "./schema";

export type LaunchPayload = {
  channel: "SEARCH";
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

export function buildLaunchPayload(draft: CampaignDraft): LaunchPayload {
  return {
    channel: "SEARCH",
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
    budget: {
      daily_usd: draft.budget.dailyUsd,
      bidding_strategy: draft.budget.biddingStrategy,
      ...(draft.budget.maxCpcUsd != null
        ? { max_cpc_usd: draft.budget.maxCpcUsd }
        : {}),
      ...(draft.budget.targetCpaUsd != null
        ? { target_cpa_usd: draft.budget.targetCpaUsd }
        : {}),
    },
    ad_copy: {
      headlines: draft.adCopy.headlines,
      descriptions: draft.adCopy.descriptions,
      keywords: draft.adCopy.keywords,
      ...(draft.adCopy.negativeKeywords &&
      draft.adCopy.negativeKeywords.length > 0
        ? { negative_keywords: draft.adCopy.negativeKeywords }
        : {}),
    },
  };
}
