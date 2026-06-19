/**
 * Prompt templates for the COPY side of the AI pipeline (SEARCH + PMAX
 * text assets). Image-side prompts are written by the architect at
 * runtime — see `architect.ts` — so they can incorporate the chosen
 * style pack.
 */
import type { AdBrief } from "./types";

function commonPreamble(brief: AdBrief): string {
  return [
    `You are an expert Google Ads copywriter.`,
    `Brand: ${brief.brandName}`,
    `Product / offering:\n${brief.productDescription}`,
    brief.landingPageUrl ? `Landing page: ${brief.landingPageUrl}` : "",
    brief.countryCode ? `Country: ${brief.countryCode}` : "",
    brief.keywords?.length ? `Seed keywords: ${brief.keywords.join(", ")}` : "",
    brief.tone ? `Tone: ${brief.tone}` : "Tone: friendly, confident",
  ]
    .filter(Boolean)
    .join("\n");
}

export function searchCopyPrompt(brief: AdBrief): string {
  return `${commonPreamble(brief)}

TASK: Generate Google Ads SEARCH (Responsive Search Ads) copy.

Requirements:
  - Exactly 15 unique headlines (≤30 characters each, including spaces).
  - Exactly 4 unique descriptions (≤90 characters each).
  - 15 keyword suggestions (≤80 chars each; prefer 2-4 word phrases).
  - Headlines should each push a distinct angle: benefit, social proof,
    urgency, feature, price/offer, brand, question, CTA.
  - Avoid superlatives that violate Google policy ("#1", "best",
    "guaranteed") without proof.
  - No emojis. No double exclamation marks. No trademark conflicts.

Return ONLY valid JSON matching the provided schema. No prose, no headers,
no markdown fences.`;
}

export function pmaxCopyPrompt(brief: AdBrief): string {
  return `${commonPreamble(brief)}

TASK: Generate Google Ads Performance Max (PMAX) copy.

Requirements:
  - businessName: ≤25 chars (the brand as it should appear on placements).
  - 15 unique short headlines (≤30 chars each).
  - 5 unique long headlines (≤90 chars each).
  - 5 unique descriptions (≤90 chars each).
  - Variety: benefit, social proof, urgency, feature, price/offer, brand,
    question, CTA. No duplicates.
  - Avoid superlatives without proof. No emojis. No double exclamation
    marks.

Return ONLY valid JSON matching the provided schema. No prose, no markdown
fences.`;
}
