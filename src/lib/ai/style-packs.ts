/**
 * Style Packs — the "design DNA" inputs the architect feeds into the
 * master prompt. Each pack encodes ONE specific creative move learned
 * from the reference-ads corpus (see /reference_ads/MANIFEST.md).
 *
 * Source of truth:
 *   - Hand-curated seed: `style-packs.seed.json` (works without API)
 *   - Vision-enriched:   `style-packs.json` (produced by ingest-references)
 *
 * The pack the architect picks gets serialized into the master prompt
 * so the image model knows exactly what palette + composition + mood +
 * technique to render.
 */

export type StylePackMode = "clean-image" | "designed-creative";
export type PhotographicStyle = "photo" | "illustration" | "mixed";
export type FontWeight = "serif" | "sans" | "display";
export type TextPlacement = "top" | "center" | "bottom" | "overlay";

export type ColorPalette = {
  /** Dominant brand-accent color. Hex (#RRGGBB). */
  primary: string;
  /** Supporting color — usually a neutral or complementary. */
  secondary: string;
  /** Accent — used sparingly (offer chips, accent shapes). */
  accent: string;
};

export type TextOnCanvas = {
  fontWeight: FontWeight;
  /** Approximate word count of the headline baked into the canvas. */
  wordCount: number;
  placement: TextPlacement;
};

export type StylePack = {
  /** Stable kebab-case identifier. */
  id: string;
  /** Human-readable label for UIs / logs. */
  label: string;
  /** Sector slug — used for sector→pack lookup. */
  sector: string;
  mode: StylePackMode;
  palette: ColorPalette;
  /** 1-sentence composition rule the model should follow. */
  composition: string;
  /** 3-5 mood adjectives. */
  mood: string[];
  photographicStyle: PhotographicStyle;
  /** One-sentence "design move" — the specific thing to do. */
  technique: string;
  /** Only present when mode = designed-creative. */
  textOnCanvas?: TextOnCanvas;
  /** Reference-ad filenames this pack was learned from. */
  sourceFiles: string[];
};

export type StylePackLibrary = {
  packs: StylePack[];
  /** ISO datetime; useful when comparing seed vs vision-enriched. */
  generatedAt: string;
  source: "hand-curated" | "vision-ingest";
};

// ---------------------------------------------------------------------------
// Library loader — prefers vision-enriched JSON over the hand-curated seed
// when the script has been run (scripts/ingest-reference-ads.mjs).
// ---------------------------------------------------------------------------

import seedJson from "./style-packs.seed.json";

// Optional vision-enriched library. Webpack/Turbopack will fail the import
// if the file doesn't exist, so we try-catch and silently fall back.
let visionLib: StylePackLibrary | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const visionJson = require("./style-packs.json") as StylePackLibrary;
  if (visionJson?.packs?.length) visionLib = visionJson;
} catch {
  // No vision-enriched file yet — that's fine, we use the seed.
}

let cachedSeed: StylePackLibrary | null = null;

/**
 * The style-pack library the architect picks from. Order of preference:
 *   1. `style-packs.json` — vision-enriched output of
 *      `scripts/ingest-reference-ads.mjs` (run on demand, ~$0.40/run).
 *   2. `style-packs.seed.json` — hand-curated fallback distilled from
 *      `reference_ads/MANIFEST.md`. Always available.
 */
export function loadSeedLibrary(): StylePackLibrary {
  if (visionLib) return visionLib;
  if (!cachedSeed) {
    cachedSeed = seedJson as StylePackLibrary;
  }
  return cachedSeed;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function findPackById(
  library: StylePackLibrary,
  id: string,
): StylePack | null {
  return library.packs.find((p) => p.id === id) ?? null;
}

export function findPacksForSector(
  library: StylePackLibrary,
  sector: string,
): StylePack[] {
  return library.packs.filter((p) => p.sector === sector);
}

/**
 * Pick the best pack for a brief. Falls back through:
 *   1. exact sector + mode match
 *   2. exact sector match (any mode)
 *   3. any pack in the requested mode
 *   4. first pack in the library (always returns something)
 */
export function pickPackForBrief(
  library: StylePackLibrary,
  brief: { sector: string; preferredMode?: StylePackMode },
): StylePack {
  const sectorPacks = findPacksForSector(library, brief.sector);
  if (brief.preferredMode) {
    const exact = sectorPacks.find((p) => p.mode === brief.preferredMode);
    if (exact) return exact;
  }
  if (sectorPacks.length > 0) return sectorPacks[0]!;
  if (brief.preferredMode) {
    const anyModeMatch = library.packs.find(
      (p) => p.mode === brief.preferredMode,
    );
    if (anyModeMatch) return anyModeMatch;
  }
  if (library.packs.length === 0) {
    throw new Error("Style pack library is empty.");
  }
  return library.packs[0]!;
}

/**
 * Serialize a pack into a chunk of prompt text the image model can act on.
 * Used by the architect when building the master prompt.
 */
export function packToPromptBlock(pack: StylePack): string {
  const lines = [
    `STYLE PACK: ${pack.label}`,
    `Mode: ${pack.mode === "clean-image" ? "Clean image (no text in canvas — Google adds copy around it)" : "Designed creative (text baked into the canvas)"}`,
    `Composition: ${pack.composition}`,
    `Technique: ${pack.technique}`,
    `Mood: ${pack.mood.join(", ")}`,
    `Photographic style: ${pack.photographicStyle}`,
    `Palette: primary ${pack.palette.primary}, secondary ${pack.palette.secondary}, accent ${pack.palette.accent}`,
  ];
  if (pack.textOnCanvas) {
    lines.push(
      `Text on canvas: ${pack.textOnCanvas.wordCount}-word headline, ${pack.textOnCanvas.fontWeight}, ${pack.textOnCanvas.placement}`,
    );
  } else {
    lines.push(
      `Text on canvas: NONE — render NO text, NO CTA, NO brand wordmark inside the image. Google's chrome adds those externally.`,
    );
  }
  return lines.join("\n");
}
