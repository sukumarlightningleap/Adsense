/**
 * High-level copy generation. Wraps Gemini text calls with prompt building,
 * JSON-schema enforcement, and a final hard-clip pass so output never
 * violates Google's character limits — even if the model misbehaves.
 */
import { generateText } from "./gemini-client";
import { pmaxCopyPrompt, searchCopyPrompt } from "./prompts";
import type {
  AdBrief,
  GeneratedClusteredPmaxCopy,
  GeneratedClusteredSearchCopy,
  GeneratedPmaxCopy,
  GeneratedSearchCopy,
  PmaxAssetGroupCluster,
  ThemeCluster,
} from "./types";

// Schema mirrors PmaxAdCopySchema field names so the wizard can spread the
// result directly into draft.pmaxAdCopy.
const PMAX_SCHEMA = {
  type: "object",
  required: ["businessName", "headlines", "longHeadlines", "descriptions"],
  properties: {
    businessName: { type: "string", maxLength: 25 },
    headlines: {
      type: "array",
      minItems: 15,
      maxItems: 15,
      items: { type: "string", maxLength: 30 },
    },
    longHeadlines: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: { type: "string", maxLength: 90 },
    },
    descriptions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: { type: "string", maxLength: 90 },
    },
  },
} as const;

const SEARCH_SCHEMA = {
  type: "object",
  required: ["headlines", "descriptions", "keywords"],
  properties: {
    headlines: {
      type: "array",
      minItems: 15,
      maxItems: 15,
      items: { type: "string", maxLength: 30 },
    },
    descriptions: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string", maxLength: 90 },
    },
    keywords: {
      type: "array",
      minItems: 10,
      maxItems: 25,
      items: { type: "string", maxLength: 80 },
    },
  },
} as const;

// Belt + braces: Gemini usually respects maxLength in the schema, but
// occasionally returns longer strings. We hard-clip on our side so we
// never feed an out-of-spec value to the Google Ads launcher.
function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = it.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function generatePmaxCopy(
  brief: AdBrief,
): Promise<GeneratedPmaxCopy> {
  const raw = await generateText<GeneratedPmaxCopy>({
    prompt: pmaxCopyPrompt(brief),
    schema: PMAX_SCHEMA,
  });
  return {
    businessName: clip(raw.businessName ?? brief.brandName, 25),
    headlines: dedupe(raw.headlines ?? [])
      .map((s) => clip(s, 30))
      .slice(0, 15),
    longHeadlines: dedupe(raw.longHeadlines ?? [])
      .map((s) => clip(s, 90))
      .slice(0, 5),
    descriptions: dedupe(raw.descriptions ?? [])
      .map((s) => clip(s, 90))
      .slice(0, 5),
  };
}

export async function generateSearchCopy(
  brief: AdBrief,
): Promise<GeneratedSearchCopy> {
  const raw = await generateText<GeneratedSearchCopy>({
    prompt: searchCopyPrompt(brief),
    schema: SEARCH_SCHEMA,
  });
  return {
    headlines: dedupe(raw.headlines ?? [])
      .map((s) => clip(s, 30))
      .slice(0, 15),
    descriptions: dedupe(raw.descriptions ?? [])
      .map((s) => clip(s, 90))
      .slice(0, 4),
    keywords: dedupe(raw.keywords ?? [])
      .map((s) => clip(s, 80))
      .slice(0, 25),
  };
}

// ===========================================================================
// Multi-ad-group SEARCH copy (Phase A5).
//
// Asks the model for 1-5 themed ad-group "clusters" — each is a tight
// keyword group with ads tuned to that specific buyer intent. Mirrors
// Google's 2026 best practice (5-15 keywords per ad group, ad copy
// answerable by every keyword in the group).
//
// The architect-suggested theme labels we steer toward:
//   • Branded       — searches for the brand/product by name
//   • Informational — users researching the topic
//   • Competitor    — comparing to alternatives
//   • Pain-point    — searching their problem
//   • Audience-X    — e.g. "for busy professionals"
// ===========================================================================

const CLUSTERED_SEARCH_SCHEMA = {
  type: "object",
  required: ["clusters"],
  properties: {
    clusters: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        required: ["themeLabel", "intent", "headlines", "descriptions", "keywords"],
        properties: {
          themeLabel: { type: "string", minLength: 2, maxLength: 50 },
          intent: { type: "string", minLength: 5, maxLength: 500 },
          headlines: {
            type: "array",
            minItems: 5,
            maxItems: 12,
            items: { type: "string", maxLength: 30 },
          },
          descriptions: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string", maxLength: 90 },
          },
          keywords: {
            type: "array",
            minItems: 5,
            maxItems: 15,
            items: { type: "string", maxLength: 80 },
          },
        },
      },
    },
  },
} as const;

function clusteredSearchPrompt(brief: AdBrief): string {
  return `You are an expert Google Ads strategist.

Brand: ${brief.brandName}
Product / offering:
${brief.productDescription}
${brief.landingPageUrl ? `Landing page: ${brief.landingPageUrl}` : ""}
${brief.countryCode ? `Country: ${brief.countryCode}` : ""}
${brief.tone ? `Tone: ${brief.tone}` : "Tone: friendly, confident"}

TASK: Plan a multi-ad-group SEARCH campaign for this brand.

Generate 1-5 themed ad-group clusters. Each cluster is a tight thematic
group of keywords + ads that share a single buyer intent. Google's 2026
best practice: 5-15 keywords per ad group with ad copy that speaks to
all of them.

Pick the number of clusters based on the brief's breadth:
  • Narrow product, one buyer mindset → 1-2 clusters
  • Mid-sized product with research + buy intents → 3 clusters
  • Broad product or established brand with competitors → 4-5 clusters

Common themes to draw from:
  • Branded       — searches for the brand/product by name
  • Informational — users researching the topic
  • Competitor    — comparing to alternatives
  • Pain-point    — searching their problem
  • Audience-X    — e.g. "for busy professionals"

For EACH cluster, produce:
  - themeLabel  — short noun (e.g. "Branded", "Informational")
  - intent      — 1-sentence buyer intent for this cluster
  - headlines   — 5-12 RSA headlines (≤30 chars each) tuned to THIS theme
  - descriptions — 2-4 RSA descriptions (≤90 chars each)
  - keywords    — 5-15 keywords matched to this intent (≤80 chars each;
                  prefer 2-4 word phrases)

Hard rules:
  • No emojis. No double exclamation marks. No superlatives without proof
    ("#1", "best", "guaranteed").
  • Every keyword in a cluster must be answerable by EVERY headline in
    that cluster.
  • Themes must NOT overlap — each keyword belongs to exactly one cluster.

Return ONLY valid JSON matching the schema. No prose, no markdown fences.`;
}

// ===========================================================================
// Multi-asset-group PMAX copy (Phase A5).
//
// PMAX best practice: most campaigns use ONE asset group. Multi-group
// is only worthwhile when there are DISTINCT buyer personas or
// lifecycle stages in the brief. Cap at 3.
// ===========================================================================

const CLUSTERED_PMAX_SCHEMA = {
  type: "object",
  required: ["clusters"],
  properties: {
    clusters: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        required: [
          "themeLabel",
          "intent",
          "headlines",
          "longHeadlines",
          "descriptions",
          "businessName",
        ],
        properties: {
          themeLabel: { type: "string", minLength: 2, maxLength: 50 },
          intent: { type: "string", minLength: 5, maxLength: 500 },
          headlines: {
            type: "array",
            minItems: 3,
            maxItems: 15,
            items: { type: "string", maxLength: 30 },
          },
          longHeadlines: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string", maxLength: 90 },
          },
          descriptions: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: { type: "string", maxLength: 90 },
          },
          businessName: { type: "string", minLength: 1, maxLength: 25 },
        },
      },
    },
  },
} as const;

function clusteredPmaxPrompt(brief: AdBrief): string {
  return `You are an expert Google Ads strategist.

Brand: ${brief.brandName}
Product / offering:
${brief.productDescription}
${brief.landingPageUrl ? `Landing page: ${brief.landingPageUrl}` : ""}
${brief.countryCode ? `Country: ${brief.countryCode}` : ""}
${brief.tone ? `Tone: ${brief.tone}` : "Tone: friendly, confident"}

TASK: Plan a Performance Max campaign with 1-3 asset groups.

PMAX best practice (2026): most campaigns ship with ONE asset group.
Only split into multiple asset groups when the brief mentions DISTINCT
buyer personas, lifecycle stages, or product lines that deserve
separately-tuned copy.

Pick the count:
  • Default → 1 asset group (covers everyone)
  • Two distinct personas mentioned → 2 asset groups
  • Multi-product / multi-funnel → 3 asset groups (cap)

Common audience themes to draw from:
  • "Generic awareness" — broad audience, no specific intent
  • "Researcher"        — comparing options
  • "Ready to buy"      — high purchase intent
  • "Existing customer" — retention / upsell
  • "Audience-X"        — e.g. "for parents", "for B2B"

For EACH asset group, produce:
  - themeLabel    — short noun (e.g. "Researcher", "Ready to buy")
  - intent        — 1-sentence buyer intent
  - headlines     — 3-15 short headlines (≤30 chars each)
  - longHeadlines — 1-5 long headlines (≤90 chars each)
  - descriptions  — 2-5 descriptions (≤90 chars each)
  - businessName  — ≤25 chars (usually the brand; can vary by asset group)

Hard rules:
  • No emojis. No double exclamation marks. No superlatives without proof.
  • Each asset group's headlines + descriptions must work for the SAME
    landing page (images + targeting can differ; landing page is shared).
  • Theme labels must be distinct.

Return ONLY valid JSON. No prose, no markdown fences.`;
}

export async function generateClusteredPmaxCopy(
  brief: AdBrief,
): Promise<GeneratedClusteredPmaxCopy> {
  const raw = await generateText<GeneratedClusteredPmaxCopy>({
    prompt: clusteredPmaxPrompt(brief),
    schema: CLUSTERED_PMAX_SCHEMA,
  });
  const clusters: PmaxAssetGroupCluster[] = (raw.clusters ?? [])
    .slice(0, 3)
    .map((c) => ({
      themeLabel: clip(c.themeLabel ?? "Default", 50),
      intent: clip(c.intent ?? "", 500),
      headlines: dedupe(c.headlines ?? [])
        .map((s) => clip(s, 30))
        .slice(0, 15),
      longHeadlines: dedupe(c.longHeadlines ?? [])
        .map((s) => clip(s, 90))
        .slice(0, 5),
      descriptions: dedupe(c.descriptions ?? [])
        .map((s) => clip(s, 90))
        .slice(0, 5),
      businessName: clip(c.businessName ?? brief.brandName, 25),
    }));
  if (clusters.length === 0) {
    clusters.push({
      themeLabel: "Default",
      intent: brief.productDescription.slice(0, 200),
      headlines: [brief.brandName.slice(0, 30)],
      longHeadlines: [brief.productDescription.slice(0, 90)],
      descriptions: [brief.productDescription.slice(0, 90)],
      businessName: brief.brandName.slice(0, 25),
    });
  }
  return { clusters };
}

export async function generateClusteredSearchCopy(
  brief: AdBrief,
): Promise<GeneratedClusteredSearchCopy> {
  const raw = await generateText<GeneratedClusteredSearchCopy>({
    prompt: clusteredSearchPrompt(brief),
    schema: CLUSTERED_SEARCH_SCHEMA,
  });
  const clusters: ThemeCluster[] = (raw.clusters ?? []).slice(0, 5).map(
    (c) => ({
      themeLabel: clip(c.themeLabel ?? "Default", 50),
      intent: clip(c.intent ?? "", 500),
      headlines: dedupe(c.headlines ?? [])
        .map((s) => clip(s, 30))
        .slice(0, 15),
      descriptions: dedupe(c.descriptions ?? [])
        .map((s) => clip(s, 90))
        .slice(0, 4),
      keywords: dedupe(c.keywords ?? [])
        .map((s) => clip(s, 80))
        .slice(0, 50),
    }),
  );
  // Guarantee at least one cluster so downstream code can assume the
  // array is non-empty.
  if (clusters.length === 0) {
    clusters.push({
      themeLabel: "Default",
      intent: brief.productDescription.slice(0, 200),
      headlines: [brief.brandName.slice(0, 30)],
      descriptions: [brief.productDescription.slice(0, 90)],
      keywords: [brief.brandName.toLowerCase()],
    });
  }
  return { clusters };
}
