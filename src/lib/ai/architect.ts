/**
 * Architect — turns a brief into a campaign plan: picks a style pack,
 * confirms / infers the sector, and authors the 5 prompts the image
 * pipelines need:
 *
 *   - master  : complete description of the final ad canvas
 *               (used directly in fast mode, or as fusion recipe in refined)
 *   - subject : the hero subject in isolation       (refined-mode intermediate)
 *   - scene   : the setting in isolation            (refined-mode intermediate)
 *   - style   : the visual treatment in isolation   (refined-mode intermediate)
 *   - logo    : a 1:1 brand mark concept (separate, always generated standalone)
 *
 * The architect is intentionally the single "creative brain" — both
 * pipelines call `planCampaign()` first, then dispatch differently.
 */
import { generateText } from "./gemini-client";
import {
  loadSeedLibrary,
  packToPromptBlock,
  pickPackForBrief,
  type StylePack,
} from "./style-packs";
import type { AdBrief } from "./types";

export type CampaignPlan = {
  /** Sector slug the architect confirmed / inferred. */
  sector: string;
  /** Style pack the architect chose (after seeing the brief). */
  pack: StylePack;
  /** The 5 image prompts. */
  prompts: {
    master: string;
    subject: string;
    scene: string;
    style: string;
    logo: string;
  };
};

const PLAN_SCHEMA = {
  type: "object",
  required: ["sector", "packId", "prompts"],
  properties: {
    sector: { type: "string", minLength: 2, maxLength: 40 },
    /**
     * The architect may swap the candidate pack — it returns the chosen
     * pack's id back to us so we can re-look-up its full data.
     */
    packId: { type: "string", minLength: 2, maxLength: 100 },
    prompts: {
      type: "object",
      required: ["master", "subject", "scene", "style", "logo"],
      properties: {
        master: { type: "string", minLength: 80, maxLength: 2000 },
        subject: { type: "string", minLength: 40, maxLength: 1000 },
        scene: { type: "string", minLength: 40, maxLength: 1000 },
        style: { type: "string", minLength: 40, maxLength: 1000 },
        logo: { type: "string", minLength: 40, maxLength: 1000 },
      },
    },
  },
} as const;

type RawPlan = {
  sector: string;
  packId: string;
  prompts: {
    master: string;
    subject: string;
    scene: string;
    style: string;
    logo: string;
  };
};

export async function planCampaign(brief: AdBrief): Promise<CampaignPlan> {
  const library = loadSeedLibrary();

  // Pre-select a candidate pack if the brief gave us a sector hint.
  const candidate: StylePack | null = brief.sector
    ? pickPackForBrief(library, {
        sector: brief.sector,
        preferredMode: brief.preferredMode,
      })
    : null;

  const availableSectors = Array.from(
    new Set(library.packs.map((p) => p.sector)),
  ).sort();

  const availablePackIds = library.packs
    .map((p) => `${p.id} (${p.sector}, ${p.mode})`)
    .join("\n  ");

  const prompt = buildArchitectPrompt(brief, candidate, {
    availableSectors,
    availablePackIds,
  });

  const raw = await generateText<RawPlan>({
    prompt,
    schema: PLAN_SCHEMA,
    // Lower temperature — we want consistent planning, not wild
    // variation. The image model brings the creativity downstream.
    temperature: 0.4,
  });

  // Resolve the chosen pack id back to its full data. If the architect
  // hallucinated an id, fall back to the candidate / first matching
  // sector pack so we never bubble up "pack not found".
  const chosen =
    library.packs.find((p) => p.id === raw.packId) ??
    candidate ??
    pickPackForBrief(library, {
      sector: raw.sector,
      preferredMode: brief.preferredMode,
    });

  return {
    sector: raw.sector,
    pack: chosen,
    prompts: raw.prompts,
  };
}

function buildArchitectPrompt(
  brief: AdBrief,
  candidate: StylePack | null,
  meta: { availableSectors: string[]; availablePackIds: string },
): string {
  return `You are an art director planning a Google Ads creative.

BRIEF:
  Brand: ${brief.brandName}
  Product / offering: ${brief.productDescription}
  Landing page: ${brief.landingPageUrl || "n/a"}
  Country: ${brief.countryCode || "n/a"}
  Tone: ${brief.tone || "friendly, confident"}
  Suggested sector: ${brief.sector || "(infer from the brand + product)"}
  Preferred mode: ${brief.preferredMode || "(decide based on the category)"}

AVAILABLE SECTORS (pick one):
  ${meta.availableSectors.join(", ")}

AVAILABLE STYLE PACKS (pick one id):
  ${meta.availablePackIds}

${
  candidate
    ? `CANDIDATE STYLE PACK (you may swap it for a better fit):\n${packToPromptBlock(candidate)}\n`
    : "No candidate — pick the pack that best matches the brief.\n"
}

TASK: Author the 5 image prompts the downstream image model will render.

PROMPT TYPES:
  1. master  — the COMPLETE description of the final ad canvas (subject +
               scene + style). Used directly in fast mode; used as the
               fusion recipe in refined mode.
  2. subject — describes ONLY the hero subject (the "what"). No setting,
               no style flourish.
  3. scene   — describes ONLY the setting / background (the "where"). No
               subject.
  4. style   — describes ONLY the visual treatment: palette, mood,
               composition, photographic vs illustrated style.
  5. logo    — describes a 1:1 logo concept for this brand. Clean, simple,
               vector-style, brand-color, NO literal text rendering.

HARD RULES — apply to ALL prompts:
  • NO text, NO CTA button, NO advertiser-identity bar, NO "See more ads"
    chip inside the image canvas.
    EXCEPTION: if the chosen pack is "designed-creative", you MAY bake the
    main headline into the canvas as the central typographic element —
    nothing else.
  • Subject occupies 40-60% of canvas, centered or rule-of-thirds.
  • Keep all important elements within the inner 60% (safe zone — sharp
    will center-crop to landscape 1.91:1 and portrait 4:5).
  • ONE dominant brand color + neutrals. Never rainbow.
  • Follow the chosen pack's technique sentence to the letter.

Return ONLY JSON matching the schema. No prose, no markdown fences.`;
}
