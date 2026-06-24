/**
 * Fast / one-shot pipeline.
 *
 *   architect → 1 master image call → sharp → persist
 *
 * Total Gemini image calls: 1 (master only).
 * Sharp crops the master into landscape / square / portrait variants
 * for the 3 marketing slots. Logo is NOT generated here — most
 * customers have an existing logo they'd rather upload. The form
 * exposes an explicit "Generate logo for me" button that calls
 * `generateLogoOnlyAction` if they don't have one.
 *
 * Total fast-mode spend: ~$0.04 of Gemini per campaign (down from
 * ~$0.08 when logo was auto-generated).
 */
import { renderImage } from "./image-generator";
import { persistGeneratedImage } from "./asset-persistence";
import type { CampaignPlan } from "./architect";
import type { AdBrief } from "./types";
import type { GeneratedAssetIds } from "./pipeline-shared";

/**
 * Run the simple pipeline. Caller has already produced the plan; this
 * keeps the architect call out of the pipeline so the router can decide
 * what to do with it (e.g. log it, surface it in audit, etc.).
 */
export async function runSimplePipeline(
  brief: AdBrief,
  plan: CampaignPlan,
  opts: { userId: string; accountId: string | null },
): Promise<GeneratedAssetIds> {
  const masterImg = await renderImage(plan.prompts.master);

  const masterParentId = await persistGeneratedImage(masterImg, {
    userId: opts.userId,
    accountId: opts.accountId,
    isLogo: false,
    label: `AI · ${brief.brandName} · master (fast)`,
    auditSource: "pipeline-simple:master",
  });

  // All 3 marketing role slots point at the same master parent. The PMAX
  // adapter resolves the right sharp variant per role at launch time.
  // Logo slots intentionally omitted — the user fills them via upload
  // or `generateLogoOnlyAction`.
  return {
    marketingImageAssetId: masterParentId,
    squareMarketingImageAssetId: masterParentId,
    portraitMarketingImageAssetId: masterParentId,
  };
}
