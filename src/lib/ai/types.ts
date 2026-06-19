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
