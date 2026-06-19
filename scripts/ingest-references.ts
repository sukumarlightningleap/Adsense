/**
 * One-shot ingestion CLI — scans every reference ad in
 * `reference_ads/*.png`, runs each through Gemini Vision, and writes
 * the validated Style Packs to `src/lib/ai/style-packs.json`.
 *
 * Run only after GEMINI_API_KEY is unblocked.
 *
 * Usage:
 *   npm run ingest:references                # ingest all
 *   npm run ingest:references -- 16-23-06    # ingest one by filename substring
 *
 * Output file is merge-deduped on `id`, so re-running re-enriches without
 * losing hand-curated entries.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import seedJson from "../src/lib/ai/style-packs.seed.json" with { type: "json" };
import { ingestReferenceAd } from "../src/lib/ai/vision-ingest.ts";
import type { StylePack, StylePackLibrary } from "../src/lib/ai/style-packs.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REFERENCE_DIR = path.join(REPO_ROOT, "reference_ads");
const OUTPUT_FILE = path.join(
  REPO_ROOT,
  "src",
  "lib",
  "ai",
  "style-packs.json",
);

/**
 * Map from filename → seed metadata (sector + expected mode). Drives the
 * sector slugs we pass into ingestReferenceAd. Sourced from MANIFEST.md
 * §5; update this when you add new reference files.
 */
const SEED_INDEX: Record<string, { sector: string; expectedMode: "clean-image" | "designed-creative" }> = {
  "16-23-06": { sector: "publishing", expectedMode: "designed-creative" },
  "16-23-14": { sector: "publishing", expectedMode: "designed-creative" },
  "16-23-22": { sector: "publishing", expectedMode: "designed-creative" },
  "16-24-05": { sector: "publishing", expectedMode: "designed-creative" },
  "16-24-13": { sector: "publishing", expectedMode: "clean-image" },
  "16-24-51": { sector: "publishing", expectedMode: "clean-image" },
  "16-26-27": { sector: "publishing", expectedMode: "clean-image" },
  "16-27-14": { sector: "publishing", expectedMode: "clean-image" },
  "16-27-45": { sector: "publishing", expectedMode: "clean-image" },
  "16-28-44": { sector: "publishing", expectedMode: "designed-creative" },
  "16-28-48": { sector: "publishing", expectedMode: "clean-image" },
  "16-28-52": { sector: "publishing", expectedMode: "designed-creative" },
  "16-30-07": { sector: "publishing", expectedMode: "clean-image" },
  "16-30-15": { sector: "publishing", expectedMode: "clean-image" },
  "16-30-27": { sector: "publishing", expectedMode: "clean-image" },
  "16-30-47": { sector: "publishing", expectedMode: "clean-image" },
  "16-31-30": { sector: "publishing", expectedMode: "clean-image" },
  "16-32-11": { sector: "promotional", expectedMode: "designed-creative" },
  "16-33-00": { sector: "subscription", expectedMode: "designed-creative" },
  "16-33-07": { sector: "subscription", expectedMode: "clean-image" },
  "16-33-12": { sector: "subscription", expectedMode: "designed-creative" },
  "16-33-29": { sector: "subscription", expectedMode: "designed-creative" },
  "16-34-01": { sector: "saas", expectedMode: "clean-image" },
  "16-35-58": { sector: "services", expectedMode: "clean-image" },
  "16-36-21": { sector: "services", expectedMode: "clean-image" },
  "16-36-42": { sector: "services", expectedMode: "clean-image" },
  "16-37-33": { sector: "ecommerce-home", expectedMode: "clean-image" },
  "16-37-50": { sector: "ecommerce-home", expectedMode: "clean-image" },
  "16-38-12": { sector: "ecommerce-home", expectedMode: "clean-image" },
  "16-39-03": { sector: "ecommerce-apparel", expectedMode: "clean-image" },
  "16-39-36": { sector: "ecommerce-apparel", expectedMode: "clean-image" },
  "16-41-00": { sector: "native", expectedMode: "clean-image" },
  "16-41-54": { sector: "subscription", expectedMode: "designed-creative" },
  "16-42-07": { sector: "subscription", expectedMode: "designed-creative" },
  "16-42-22": { sector: "subscription", expectedMode: "designed-creative" },
  "16-42-53": { sector: "lifestyle", expectedMode: "clean-image" },
  "16-43-18": { sector: "subscription", expectedMode: "designed-creative" },
  "16-43-43": { sector: "saas", expectedMode: "clean-image" },
  "16-44-12": { sector: "auto", expectedMode: "designed-creative" },
  "16-45-40": { sector: "native", expectedMode: "clean-image" },
  "16-46-06": { sector: "fintech", expectedMode: "designed-creative" },
  "16-46-19": { sector: "fintech", expectedMode: "designed-creative" },
};

function timestampFromFilename(filename: string): string | null {
  const m = /(\d{2}-\d{2}-\d{2})/.exec(filename);
  return m ? m[1]! : null;
}

async function main() {
  const filterArg = process.argv[2];

  const allFiles = await readdir(REFERENCE_DIR);
  const pngs = allFiles
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .filter((f) => !filterArg || f.includes(filterArg))
    .sort();

  if (pngs.length === 0) {
    console.error("No PNG files matched.");
    process.exit(1);
  }

  console.log(`Ingesting ${pngs.length} file(s)…`);

  const packs: StylePack[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const filename of pngs) {
    const ts = timestampFromFilename(filename);
    const seed = ts ? SEED_INDEX[ts] : undefined;
    if (!seed) {
      console.warn(`  [skip] ${filename} — no seed entry (add it to SEED_INDEX)`);
      continue;
    }
    try {
      const bytes = await readFile(path.join(REFERENCE_DIR, filename));
      const pack = await ingestReferenceAd(bytes, {
        seed: {
          sector: seed.sector,
          expectedMode: seed.expectedMode,
          sourceFile: filename,
        },
      });
      packs.push(pack);
      succeeded++;
      console.log(`  [ok]   ${filename} → ${pack.id}`);
    } catch (e) {
      failed++;
      console.error(
        `  [fail] ${filename}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Merge with seed packs (vision-extracted wins on id collision, but we
  // keep seed packs whose ids weren't re-ingested this run).
  const seedLib = seedJson as StylePackLibrary;
  const ids = new Set(packs.map((p) => p.id));
  for (const sp of seedLib.packs) {
    if (!ids.has(sp.id)) packs.push(sp);
  }

  const out: StylePackLibrary = {
    packs,
    generatedAt: new Date().toISOString(),
    source: "vision-ingest",
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\nWrote ${packs.length} packs to ${path.relative(REPO_ROOT, OUTPUT_FILE)}`,
  );
  console.log(
    `Summary: ${succeeded} ok, ${failed} failed, ${packs.length - succeeded} carried over from seed.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
