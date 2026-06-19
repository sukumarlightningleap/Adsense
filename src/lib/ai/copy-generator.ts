/**
 * High-level copy generation. Wraps Gemini text calls with prompt building,
 * JSON-schema enforcement, and a final hard-clip pass so output never
 * violates Google's character limits — even if the model misbehaves.
 */
import { generateText } from "./gemini-client";
import { pmaxCopyPrompt, searchCopyPrompt } from "./prompts";
import type {
  AdBrief,
  GeneratedPmaxCopy,
  GeneratedSearchCopy,
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
