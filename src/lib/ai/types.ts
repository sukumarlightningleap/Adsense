/**
 * AI content pipeline — shared types.
 *
 * The pipeline takes a small "brief" (assembled from the wizard draft) and
 * returns text + images that map cleanly onto the existing PMAX/SEARCH
 * payload shape. No Gemini SDK leakage past this module.
 */
import type { CampaignDraft } from "@/lib/wizard/schema";

import type { StylePackMode } from "./style-packs";

export type AdBrief = {
  channel: "SEARCH" | "PMAX";
  /** Brand / business name. Used as fallback for PMAX businessName. */
  brandName: string;
  /** What the customer sells. Free-form, 1-3 sentences. */
  productDescription: string;
  /** Landing-page URL (informational for the model; not scraped yet). */
  landingPageUrl: string;
  /** Optional ISO country code for tone/spelling localization. */
  countryCode?: string;
  /** Optional seed keywords (SEARCH) or theme hints (PMAX). */
  keywords?: string[];
  /** Optional brand voice. */
  tone?: "professional" | "friendly" | "urgent" | "playful";
  /**
   * Optional sector hint (e.g. "publishing", "fintech"). If unset, the
   * architect infers it from the brief and picks a matching style pack.
   */
  sector?: string;
  /**
   * Optional creative-mode hint. If unset, the architect chooses based on
   * the brief and the candidate style pack.
   */
  preferredMode?: StylePackMode;
};

export type GeneratedSearchCopy = {
  headlines: string[];      // 15 items, ≤30 chars
  descriptions: string[];   // 4 items, ≤90 chars
  keywords: string[];       // 10-25 suggestions, ≤80 chars
};

/**
 * One ad group's worth of SEARCH content — Phase A5 (multi-ad-group).
 *
 * Each cluster is a tight thematic group of keywords + ads that share a
 * single buyer intent. Google's 2026 best practice is 5-15 keywords per
 * ad group with ad copy that speaks to all of them.
 *
 * Common themes the architect picks from:
 *   - "Branded"        — searches for the brand/product by name
 *   - "Informational"  — users researching the topic
 *   - "Competitor"     — comparing to alternatives
 *   - "Pain-point"     — searching their problem
 *   - "Audience-X"     — e.g. "for busy professionals"
 */
export type ThemeCluster = {
  /** Short noun the UI surfaces as the ad group label. */
  themeLabel: string;
  /** 1-sentence buyer intent — surfaced as a hint above the cluster. */
  intent: string;
  /** RSA headlines tuned to this theme. 3-15 items, ≤30 chars each. */
  headlines: string[];
  /** RSA descriptions for this theme. 2-4 items, ≤90 chars each. */
  descriptions: string[];
  /** Positive keywords for this theme. 1-50 items, ≤80 chars each. */
  keywords: string[];
};

export type GeneratedClusteredSearchCopy = {
  /** 1-5 ad groups — architect picks the count based on brief breadth. */
  clusters: ThemeCluster[];
};

/**
 * One PMAX asset group's worth of content — Phase A5 (multi-asset-group).
 *
 * PMAX best practice: most campaigns use 1 asset group. Multi-group only
 * when the brand has DISTINCT buyer personas / lifecycle stages /
 * product lines. Cap at 3 for v1.
 *
 * Common audience themes the architect picks from:
 *   • "Generic awareness" — broad, no specific buyer intent
 *   • "Researcher"        — comparing options
 *   • "Ready to buy"      — high purchase intent
 *   • "Existing customer" — retention / upsell
 *   • "Audience-X"        — e.g. "for parents", "for B2B"
 *
 * Image assets are SHARED across asset groups (one campaign-wide image
 * pool). Only text assets differ per cluster.
 */
export type PmaxAssetGroupCluster = {
  themeLabel: string;
  intent: string;
  headlines: string[];      // 3-15, ≤30 chars
  longHeadlines: string[];  // 1-5, ≤90 chars
  descriptions: string[];   // 2-5, ≤90 chars
  businessName: string;     // ≤25 chars (usually same brand across clusters)
};

export type GeneratedClusteredPmaxCopy = {
  /** 1-3 asset groups — architect picks count based on audience breadth. */
  clusters: PmaxAssetGroupCluster[];
};

export type GeneratedPmaxCopy = {
  headlines: string[];        // 15 items, ≤30 chars
  longHeadlines: string[];    // 5 items, ≤90 chars
  descriptions: string[];     // 5 items, ≤90 chars
  businessName: string;       // ≤25 chars
};

/** A single Gemini-rendered image — pre-resize, pre-persist. */
export type GeneratedImageBytes = {
  bytes: Buffer;
  mimeType: string;
  /** The prompt the model executed — recorded in audit log + debugging. */
  promptUsed: string;
};

/**
 * Derive a brief from the wizard draft. Pulls from whichever channel
 * slice is active. Returns empty strings (not throws) when fields are
 * still blank — the server action validates before calling Gemini.
 */
export function briefFromDraft(draft: CampaignDraft): AdBrief {
  const isPmax = draft.channel === "PMAX";
  const seedKeywords =
    !isPmax && draft.searchAdCopy?.keywords?.length
      ? draft.searchAdCopy.keywords
      : undefined;

  return {
    channel: draft.channel,
    brandName:
      (isPmax ? draft.pmaxAdCopy?.businessName : "") || draft.book.title || "",
    productDescription: draft.book.description,
    landingPageUrl: draft.book.landingPageUrl,
    countryCode: draft.audience.country,
    keywords: seedKeywords,
  };
}
