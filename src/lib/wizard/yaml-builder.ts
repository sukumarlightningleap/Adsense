/**
 * Build the YAML payload that future phases will hand to the Google Ads
 * adapter. Mirrors the shape produced by
 * `adwords-benchmarks/src/launcher/yaml_render/builders.py`.
 *
 * We don't depend on a YAML library — the structure is small and known,
 * so emitting it by hand keeps the bundle slim and the output stable
 * (no key reorderings between releases of a library).
 *
 * Channel-aware: SEARCH and PMAX emit different `ad_copy` + `budget`
 * sections so the operator can see exactly what'll be pushed.
 */
import type { CampaignDraft } from "./schema";

export function buildCampaignYaml(draft: CampaignDraft): string {
  const lines: string[] = [];

  // ---- channel + launch status ------------------------------------------
  lines.push(`channel: ${draft.channel}`);
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

  // ---- budget + bidding + ad copy --------------------------------------
  if (draft.channel === "SEARCH") {
    const b = draft.searchBudget!;
    const c = draft.searchAdCopy!;

    lines.push(`budget:`);
    lines.push(`  daily_usd: ${num(b.dailyUsd)}`);
    lines.push(`  bidding_strategy: ${q(b.biddingStrategy)}`);
    if (b.maxCpcUsd != null)
      lines.push(`  max_cpc_usd: ${num(b.maxCpcUsd)}`);
    if (b.targetCpaUsd != null)
      lines.push(`  target_cpa_usd: ${num(b.targetCpaUsd)}`);
    lines.push("");

    lines.push(`ad_copy:`);
    lines.push(`  headlines:`);
    for (const h of c.headlines) lines.push(`    - ${q(h)}`);
    lines.push(`  descriptions:`);
    for (const d of c.descriptions) lines.push(`    - ${q(d)}`);
    lines.push(`  keywords:`);
    for (const k of c.keywords) lines.push(`    - ${q(k)}`);
    if (c.negativeKeywords && c.negativeKeywords.length > 0) {
      lines.push(`  negative_keywords:`);
      for (const k of c.negativeKeywords) lines.push(`    - ${q(k)}`);
    }
  } else {
    // PMAX
    const b = draft.pmaxBudget!;
    const c = draft.pmaxAdCopy!;
    const a = draft.pmaxAssets;

    lines.push(`budget:`);
    lines.push(`  daily_usd: ${num(b.dailyUsd)}`);
    lines.push(`  bidding_strategy: ${q(b.biddingStrategy)}`);
    if (b.targetCpaUsd != null)
      lines.push(`  target_cpa_usd: ${num(b.targetCpaUsd)}`);
    if (b.targetRoas != null)
      lines.push(`  target_roas: ${num(b.targetRoas)}`);
    lines.push("");

    lines.push(`ad_copy:`);
    lines.push(`  business_name: ${q(c.businessName)}`);
    lines.push(`  headlines: # short, <=30 chars`);
    for (const h of c.headlines) lines.push(`    - ${q(h)}`);
    lines.push(`  long_headlines: # <=90 chars`);
    for (const h of c.longHeadlines) lines.push(`    - ${q(h)}`);
    lines.push(`  descriptions:`);
    for (const d of c.descriptions) lines.push(`    - ${q(d)}`);

    if (a) {
      const hasAny = Object.values(a).some(Boolean);
      if (hasAny) {
        lines.push("");
        lines.push(`assets:`);
        if (a.logoAssetId) lines.push(`  logo: ${q(a.logoAssetId)}`);
        if (a.landscapeLogoAssetId)
          lines.push(`  landscape_logo: ${q(a.landscapeLogoAssetId)}`);
        if (a.marketingImageAssetId)
          lines.push(`  marketing_image: ${q(a.marketingImageAssetId)}`);
        if (a.squareMarketingImageAssetId)
          lines.push(
            `  square_marketing_image: ${q(a.squareMarketingImageAssetId)}`,
          );
        if (a.portraitMarketingImageAssetId)
          lines.push(
            `  portrait_marketing_image: ${q(a.portraitMarketingImageAssetId)}`,
          );
      }
    }
  }

  return lines.join("\n") + "\n";
}

/** Single-line quoted string. Escapes embedded quotes. */
function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Multiline block scalar (`>-`) for long descriptions.
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
