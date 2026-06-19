/**
 * Vision-ingest — turn a reference-ad screenshot into a structured
 * StylePack the architect can read.
 *
 * The screenshot wraps the ad creative in Google's chrome (advertiser
 * bar, headline rendered below image, CTA button, "See more" chip). We
 * instruct Gemini Vision to ignore everything outside the image canvas
 * so the extracted style reflects only what WE generate.
 */
import { generateText, GeminiCallError } from "./gemini-client";
import type {
  StylePack,
  StylePackMode,
  PhotographicStyle,
} from "./style-packs";

type IngestSeed = {
  /** Sector slug the human labeler assigned (from MANIFEST.md §5). */
  sector?: string;
  /** Expected mode from the manifest. The model can override. */
  expectedMode?: StylePackMode;
  /** Filename — used to populate `sourceFiles` in the returned pack. */
  sourceFile: string;
  /** Optional id override; otherwise auto-generated from sector+mode. */
  id?: string;
  /** Human-readable label override. */
  label?: string;
};

const VISION_INGEST_PROMPT = `You are analyzing a screenshot of a Google ad to extract its design DNA.

CRITICAL — IGNORE GOOGLE CHROME.
The screenshot includes:
  - an advertiser-identity bar at the top (logo + domain)
  - a headline + description rendered BELOW the image
  - a blue "Visit Site" / "Shop now" / "Learn More" button
  - a "See more ads by this advertiser" chip
  - gray gutter / background around the ad rectangle

NONE of those are part of the creative. Analyze ONLY the inner IMAGE
CANVAS — the rectangle the advertiser actually designed.

Return JSON matching the provided schema with these fields:
  - mode: "clean-image" if the canvas has no text/CTA inside it (Google
          would layer text around it), or "designed-creative" if the
          canvas has a baked-in headline, brand wordmark, or text block.
  - palette: { primary, secondary, accent } as #RRGGBB hex strings,
             sampled from inside the canvas only.
  - composition: ONE sentence describing subject placement, breathing
                 room, and focal hierarchy.
  - mood: 3-5 adjectives describing the feel (e.g. "premium", "warm",
          "modern", "minimal", "energetic").
  - photographicStyle: "photo" | "illustration" | "mixed".
  - technique: ONE sentence naming the specific design move
               (e.g. "single product centered on solid brand-color block",
               "close-up of hands doing the work, shallow depth of field",
               "multi-cover grid under a serif headline on warm cream").
  - textOnCanvas: present ONLY when mode = "designed-creative". Object
                  with { fontWeight: "serif"|"sans"|"display", wordCount,
                  placement: "top"|"center"|"bottom"|"overlay" }.

Return ONLY valid JSON. No prose, no markdown fences.`;

const VISION_INGEST_SCHEMA = {
  type: "object",
  required: [
    "mode",
    "palette",
    "composition",
    "mood",
    "photographicStyle",
    "technique",
  ],
  properties: {
    mode: { type: "string", enum: ["clean-image", "designed-creative"] },
    palette: {
      type: "object",
      required: ["primary", "secondary", "accent"],
      properties: {
        primary: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        secondary: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      },
    },
    composition: { type: "string", minLength: 10, maxLength: 300 },
    mood: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", minLength: 2, maxLength: 30 },
    },
    photographicStyle: {
      type: "string",
      enum: ["photo", "illustration", "mixed"],
    },
    technique: { type: "string", minLength: 10, maxLength: 300 },
    textOnCanvas: {
      type: "object",
      required: ["fontWeight", "wordCount", "placement"],
      properties: {
        fontWeight: {
          type: "string",
          enum: ["serif", "sans", "display"],
        },
        wordCount: { type: "integer", minimum: 1, maximum: 100 },
        placement: {
          type: "string",
          enum: ["top", "center", "bottom", "overlay"],
        },
      },
    },
  },
} as const;

type RawIngest = {
  mode: StylePackMode;
  palette: { primary: string; secondary: string; accent: string };
  composition: string;
  mood: string[];
  photographicStyle: PhotographicStyle;
  technique: string;
  textOnCanvas?: {
    fontWeight: "serif" | "sans" | "display";
    wordCount: number;
    placement: "top" | "center" | "bottom" | "overlay";
  };
};

/**
 * Run a single reference-ad screenshot through Gemini Vision and produce
 * a structured StylePack. Caller supplies the image bytes + a small seed
 * (sector + expected mode from the manifest). The model can override the
 * expected mode if the canvas actually shows something different.
 */
export async function ingestReferenceAd(
  imageBytes: Buffer,
  opts: { mimeType?: string; seed: IngestSeed },
): Promise<StylePack> {
  const mimeType = opts.mimeType ?? "image/png";

  const raw = await generateText<RawIngest>({
    prompt: VISION_INGEST_PROMPT,
    images: [{ bytes: imageBytes, mimeType }],
    schema: VISION_INGEST_SCHEMA,
    // Low temperature — we want consistent extraction, not creative
    // variation, here.
    temperature: 0.2,
  });

  if (!raw.mode || !raw.palette?.primary) {
    throw new GeminiCallError("vision-ingest returned malformed payload");
  }

  const sector = opts.seed.sector ?? "uncategorized";
  const id =
    opts.seed.id ??
    `${sector}-${raw.mode}-${slugify(raw.technique).slice(0, 40)}`;
  const label =
    opts.seed.label ?? `${capitalize(sector)} · ${capitalize(raw.mode)}`;

  return {
    id,
    label,
    sector,
    mode: raw.mode,
    palette: raw.palette,
    composition: raw.composition,
    mood: raw.mood,
    photographicStyle: raw.photographicStyle,
    technique: raw.technique,
    textOnCanvas: raw.textOnCanvas,
    sourceFiles: [opts.seed.sourceFile],
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
