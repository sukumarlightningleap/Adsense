/**
 * Build the YAML payload that future phases will hand to the Google Ads
 * adapter. Mirrors the shape produced by
 * `adwords-benchmarks/src/launcher/yaml_render/builders.py`.
 *
 * We don't depend on a YAML library — the structure is small and known,
 * so emitting it by hand keeps the bundle slim and the output stable
 * (no key reorderings between releases of a library).
 */
import type { CampaignDraft } from "./schema";

export function buildCampaignYaml(draft: CampaignDraft): string {
  const lines: string[] = [];

  // ---- channel + launch status ------------------------------------------
  lines.push(`channel: SEARCH`); // hard-coded for Phase 3
  lines.push(`launch_status: PAUSED`); // safety: never auto-enable
  lines.push("");

  // ---- book / product ---------------------------------------------------
  lines.push(`book:`);
  lines.push(`  title: ${q(draft.book.title)}`);
  if (draft.book.isbn) {
    lines.push(`  isbn: ${q(draft.book.isbn)}`);
  }
  lines.push(`  landing_page_url: ${q(draft.book.landingPageUrl)}`);
  lines.push(`  description: ${block(draft.book.description, 4)}`);
  lines.push("");

  // ---- geo --------------------------------------------------------------
  lines.push(`geo:`);
  lines.push(`  country: ${q(draft.audience.country)}`);
  lines.push(`  scope: ${q(draft.audience.scope)}`);
  if (
    draft.audience.scope === "specific_cities" &&
    draft.audience.cities &&
    draft.audience.cities.length > 0
  ) {
    lines.push(`  cities:`);
    for (const city of draft.audience.cities) {
      lines.push(`    - ${q(city)}`);
    }
  }
  lines.push("");

  // ---- budget + bidding -------------------------------------------------
  lines.push(`budget:`);
  lines.push(`  daily_usd: ${num(draft.budget.dailyUsd)}`);
  lines.push(`  bidding_strategy: ${q(draft.budget.biddingStrategy)}`);
  if (draft.budget.maxCpcUsd != null) {
    lines.push(`  max_cpc_usd: ${num(draft.budget.maxCpcUsd)}`);
  }
  if (draft.budget.targetCpaUsd != null) {
    lines.push(`  target_cpa_usd: ${num(draft.budget.targetCpaUsd)}`);
  }
  lines.push("");

  // ---- ad copy ----------------------------------------------------------
  lines.push(`ad_copy:`);
  lines.push(`  headlines:`);
  for (const h of draft.adCopy.headlines) {
    lines.push(`    - ${q(h)}`);
  }
  lines.push(`  descriptions:`);
  for (const d of draft.adCopy.descriptions) {
    lines.push(`    - ${q(d)}`);
  }
  lines.push(`  keywords:`);
  for (const k of draft.adCopy.keywords) {
    lines.push(`    - ${q(k)}`);
  }
  if (
    draft.adCopy.negativeKeywords &&
    draft.adCopy.negativeKeywords.length > 0
  ) {
    lines.push(`  negative_keywords:`);
    for (const k of draft.adCopy.negativeKeywords) {
      lines.push(`    - ${q(k)}`);
    }
  }

  return lines.join("\n") + "\n";
}

/** Single-line quoted string. Escapes embedded quotes. */
function q(s: string): string {
  // YAML allows single-quoted strings with `''` as an escape for `'`.
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Multiline block scalar (`>-`) for long descriptions. The block scalar
 * folds newlines into spaces but preserves paragraphs separated by blank
 * lines — the shape readers expect.
 */
function block(s: string, indent: number): string {
  const pad = " ".repeat(indent);
  const lines = s.split("\n");
  return `>-\n${lines.map((l) => `${pad}${l}`).join("\n")}`;
}

/** Number formatter — trims unnecessary trailing zeros. */
function num(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
