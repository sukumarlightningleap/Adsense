/**
 * Vision-ingest runner — walks `reference_ads/`, sends each cropped ad
 * screenshot through Gemini Vision, and writes the extracted Style Packs
 * to `src/lib/ai/style-packs.json`.
 *
 * The architect prefers `style-packs.json` (vision-enriched) over
 * `style-packs.seed.json` (hand-curated fallback) — see style-packs.ts.
 *
 * Usage:
 *   node ./scripts/ingest-reference-ads.mjs            # ingest all 43 files
 *   node ./scripts/ingest-reference-ads.mjs --dry-run  # show plan, skip API calls
 *   node ./scripts/ingest-reference-ads.mjs --files 16-23-06,16-46-19   # subset
 *
 * Cost: ~$0.01/file × 43 files = ~$0.40 per full run on Vertex AI express.
 *
 * Re-runs are idempotent — the script overwrites style-packs.json wholesale.
 *
 * The per-file (sector, expectedMode) seed table below mirrors
 * `reference_ads/MANIFEST.md` §5. Keep them in sync when you add files.
 */
import "dotenv/config";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const REFERENCE_DIR = join(REPO_ROOT, "reference_ads");
const OUTPUT_PATH = join(REPO_ROOT, "src/lib/ai/style-packs.json");

// ===========================================================================
// Per-file seed (mirrors reference_ads/MANIFEST.md §5)
// ===========================================================================
const SEEDS = [
  { ts: "16-23-06", sector: "publishing", expectedMode: "designed-creative", advertiser: "Penguin RH Audio" },
  { ts: "16-23-14", sector: "publishing", expectedMode: "designed-creative", advertiser: "Penguin RH Audio" },
  { ts: "16-23-22", sector: "publishing", expectedMode: "designed-creative", advertiser: "Penguin RH Audio" },
  { ts: "16-24-05", sector: "publishing", expectedMode: "designed-creative", advertiser: "Penguin RH Audio" },
  { ts: "16-24-13", sector: "publishing", expectedMode: "clean-image", advertiser: "Penguin RH" },
  { ts: "16-24-51", sector: "publishing", expectedMode: "clean-image", advertiser: "Penguin RH (Avery)" },
  { ts: "16-26-27", sector: "publishing", expectedMode: "clean-image", advertiser: "Penguin RH" },
  { ts: "16-27-14", sector: "publishing", expectedMode: "clean-image", advertiser: "Harper Voyager" },
  { ts: "16-27-45", sector: "publishing", expectedMode: "clean-image", advertiser: "Emily Wilson Hussem" },
  { ts: "16-28-44", sector: "publishing", expectedMode: "designed-creative", advertiser: "Hachette" },
  { ts: "16-28-48", sector: "publishing", expectedMode: "clean-image", advertiser: "Hachette" },
  { ts: "16-28-52", sector: "publishing", expectedMode: "designed-creative", advertiser: "Hachette" },
  { ts: "16-30-07", sector: "publishing", expectedMode: "clean-image", advertiser: "Audible" },
  { ts: "16-30-15", sector: "publishing", expectedMode: "clean-image", advertiser: "Audible" },
  { ts: "16-30-27", sector: "publishing", expectedMode: "clean-image", advertiser: "Audible" },
  { ts: "16-30-47", sector: "publishing", expectedMode: "clean-image", advertiser: "Audible" },
  { ts: "16-31-30", sector: "publishing", expectedMode: "clean-image", advertiser: "Audible" },
  { ts: "16-32-11", sector: "promotional", expectedMode: "designed-creative", advertiser: "Blinkist" },
  { ts: "16-33-00", sector: "subscription", expectedMode: "designed-creative", advertiser: "Everand" },
  { ts: "16-33-07", sector: "subscription", expectedMode: "clean-image", advertiser: "Everand" },
  { ts: "16-33-12", sector: "subscription", expectedMode: "designed-creative", advertiser: "Everand" },
  { ts: "16-33-29", sector: "subscription", expectedMode: "designed-creative", advertiser: "Everand" },
  { ts: "16-34-01", sector: "saas", expectedMode: "clean-image", advertiser: "Notion" },
  { ts: "16-35-58", sector: "services", expectedMode: "clean-image", advertiser: "Thumbtack" },
  { ts: "16-36-21", sector: "services", expectedMode: "clean-image", advertiser: "Thumbtack" },
  { ts: "16-36-42", sector: "services", expectedMode: "clean-image", advertiser: "Thumbtack" },
  { ts: "16-37-33", sector: "ecommerce-home", expectedMode: "clean-image", advertiser: "Wayfair" },
  { ts: "16-37-50", sector: "ecommerce-home", expectedMode: "clean-image", advertiser: "Wayfair" },
  { ts: "16-38-12", sector: "ecommerce-home", expectedMode: "clean-image", advertiser: "Wayfair" },
  { ts: "16-39-03", sector: "ecommerce-apparel", expectedMode: "clean-image", advertiser: "Allbirds" },
  { ts: "16-39-36", sector: "ecommerce-apparel", expectedMode: "clean-image", advertiser: "Allbirds" },
  { ts: "16-41-00", sector: "native", expectedMode: "designed-creative", advertiser: "ArtMasterClass" },
  { ts: "16-41-54", sector: "subscription", expectedMode: "designed-creative", advertiser: "Skillshare" },
  { ts: "16-42-07", sector: "subscription", expectedMode: "designed-creative", advertiser: "Skillshare" },
  { ts: "16-42-22", sector: "subscription", expectedMode: "designed-creative", advertiser: "Skillshare" },
  { ts: "16-42-53", sector: "lifestyle", expectedMode: "clean-image", advertiser: "Skillshare" },
  { ts: "16-43-18", sector: "subscription", expectedMode: "designed-creative", advertiser: "Skillshare" },
  { ts: "16-43-43", sector: "saas", expectedMode: "clean-image", advertiser: "WiseTime / Clio" },
  { ts: "16-44-12", sector: "auto", expectedMode: "designed-creative", advertiser: "CarWise Peoria" },
  { ts: "16-45-40", sector: "native", expectedMode: "clean-image", advertiser: "Revolution Event Design" },
  { ts: "16-46-06", sector: "fintech", expectedMode: "designed-creative", advertiser: "Robinhood Crypto" },
  { ts: "16-46-19", sector: "fintech", expectedMode: "designed-creative", advertiser: "Robinhood Legend" },
];

// ===========================================================================
// Gemini Vision (AQ.* Agent Platform OR AIza AI Studio — auto-detected)
// ===========================================================================
const AI_STUDIO_HOST = "https://generativelanguage.googleapis.com/v1beta";
const AGENT_PLATFORM_HOST = "https://aiplatform.googleapis.com/v1/publishers/google";

function readKey() {
  const k = process.env.GOOGLE_AGENT_PLATFORM_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!k) throw new Error("Set GOOGLE_AGENT_PLATFORM_KEY or GEMINI_API_KEY in .env");
  return k;
}

function endpoint(model, key) {
  const host = key.startsWith("AQ.") ? AGENT_PLATFORM_HOST : AI_STUDIO_HOST;
  return `${host}/models/${model}:generateContent`;
}

const VISION_INGEST_PROMPT = `You are analyzing a CROPPED image of a Google ad's marketing-image canvas only (no chrome). Extract its design DNA.

Return JSON matching the schema. Fields:
  - mode: "clean-image" if NO text/CTA/wordmark inside the canvas, or "designed-creative" if the canvas has a baked-in headline, brand wordmark, or text block.
  - palette: { primary, secondary, accent } as #RRGGBB hex strings, sampled from inside the canvas only.
  - composition: ONE sentence on subject placement, breathing room, and focal hierarchy.
  - mood: 3-5 adjectives describing the feel.
  - photographicStyle: "photo" | "illustration" | "mixed".
  - technique: ONE sentence naming the specific design move.
  - textOnCanvas: present ONLY when mode = "designed-creative". Object with { fontWeight: "serif"|"sans"|"display", wordCount, placement: "top"|"center"|"bottom"|"overlay" }.

Return ONLY valid JSON. No prose, no markdown fences.`;

const VISION_INGEST_SCHEMA = {
  type: "object",
  required: ["mode", "palette", "composition", "mood", "photographicStyle", "technique"],
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
    mood: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", minLength: 2, maxLength: 30 } },
    photographicStyle: { type: "string", enum: ["photo", "illustration", "mixed"] },
    technique: { type: "string", minLength: 10, maxLength: 300 },
    textOnCanvas: {
      type: "object",
      required: ["fontWeight", "wordCount", "placement"],
      properties: {
        fontWeight: { type: "string", enum: ["serif", "sans", "display"] },
        wordCount: { type: "integer", minimum: 1, maximum: 100 },
        placement: { type: "string", enum: ["top", "center", "bottom", "overlay"] },
      },
    },
  },
};

async function visionIngest(key, imageBytes) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: imageBytes.toString("base64") } },
          { text: VISION_INGEST_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: VISION_INGEST_SCHEMA,
    },
  };
  const url = `${endpoint("gemini-2.5-flash", key)}?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return JSON.parse(text);
}

// ===========================================================================
// Main
// ===========================================================================
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const isDryRun = args.has("--dry-run");
  const filesArgIdx = process.argv.indexOf("--files");
  const fileFilter = filesArgIdx > 0 ? new Set(process.argv[filesArgIdx + 1].split(",")) : null;

  const allFiles = (await readdir(REFERENCE_DIR)).filter((f) => f.endsWith(".png"));
  const filesByTs = new Map();
  for (const f of allFiles) {
    const m = f.match(/(\d{2}-\d{2}-\d{2})\.png$/);
    if (m) filesByTs.set(m[1], f);
  }

  const work = SEEDS.filter((s) => filesByTs.has(s.ts))
    .filter((s) => !fileFilter || fileFilter.has(s.ts))
    .map((s) => ({ ...s, filename: filesByTs.get(s.ts) }));

  console.log(`Planned: ${work.length} ingestion${work.length === 1 ? "" : "s"} (of ${SEEDS.length} seeds, ${allFiles.length} files on disk).\n`);
  if (isDryRun) {
    work.forEach((w) => console.log(`  · ${w.ts}  [${w.sector}/${w.expectedMode}]  ${w.advertiser}  →  ${w.filename}`));
    console.log("\nDry run — no API calls. Pass without --dry-run to ingest.");
    return;
  }

  const key = readKey();
  console.log(`Using key: ${key.startsWith("AQ.") ? "AQ.* (Vertex AI express)" : "AIza* (AI Studio)"}\n`);

  const packs = [];
  const errors = [];
  for (let i = 0; i < work.length; i++) {
    const w = work[i];
    process.stdout.write(`[${i + 1}/${work.length}] ${w.ts} (${w.sector}/${w.expectedMode}) ... `);
    try {
      const bytes = await readFile(join(REFERENCE_DIR, w.filename));
      const raw = await visionIngest(key, bytes);
      const id = `${w.sector}-${raw.mode}-${slugify(raw.technique)}`;
      const pack = {
        id,
        label: `${capitalize(w.sector)} · ${capitalize(raw.mode)} · ${w.advertiser}`,
        sector: w.sector,
        mode: raw.mode,
        palette: raw.palette,
        composition: raw.composition,
        mood: raw.mood,
        photographicStyle: raw.photographicStyle,
        technique: raw.technique,
        textOnCanvas: raw.textOnCanvas,
        sourceFiles: [w.filename],
      };
      packs.push(pack);
      console.log(`OK  (${raw.mode}, ${raw.palette.primary})`);
    } catch (e) {
      console.log(`FAIL  ${e.message}`);
      errors.push({ file: w.filename, error: e.message });
    }
  }

  const library = {
    generatedAt: "2026-06-24T00:00:00.000Z",
    source: "vision-ingest",
    packs,
  };
  await writeFile(OUTPUT_PATH, JSON.stringify(library, null, 2));

  console.log(`\nWrote ${packs.length} packs → ${OUTPUT_PATH}`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} error${errors.length === 1 ? "" : "s"}:`);
    errors.forEach((e) => console.log(`  · ${e.file}: ${e.error}`));
  }
}

await main();
