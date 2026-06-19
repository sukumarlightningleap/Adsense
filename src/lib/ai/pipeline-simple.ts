/**
 * Fast / one-shot pipeline.
 *
 *   architect → 1 master image call → 1 logo image call → sharp → persist
 *
 * Total Gemini image calls: 2 (master + logo).
 * Sharp then crops the master into landscape / square / portrait
 * variants, and the logo into square + landscape logo variants — all
 * 5 Google Ads sizes for ~$0.08 of Gemini spend per campaign.
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
  // Generate master + logo in parallel — they don't depend on each other.
  const [masterImg, logoImg] = await Promise.all([
    renderImage(plan.prompts.master),
    renderImage(plan.prompts.logo),
  ]);

  const [masterParentId, logoParentId] = await Promise.all([
    persistGeneratedImage(masterImg, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: false,
      label: `AI · ${brief.brandName} · master (fast)`,
      auditSource: "pipeline-simple:master",
    }),
    persistGeneratedImage(logoImg, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: true,
      label: `AI · ${brief.brandName} · logo (fast)`,
      auditSource: "pipeline-simple:logo",
    }),
  ]);

  // All 3 marketing role slots point at the same master parent. The PMAX
  // adapter resolves the right sharp variant per role at launch time.
  // Both logo role slots point at the logo parent.
  return {
    marketingImageAssetId: masterParentId,
    squareMarketingImageAssetId: masterParentId,
    portraitMarketingImageAssetId: masterParentId,
    logoAssetId: logoParentId,
    landscapeLogoAssetId: logoParentId,
  };
}
