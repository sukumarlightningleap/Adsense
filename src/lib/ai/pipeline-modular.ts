/**
 * Refined / Whisk-style pipeline.
 *
 *   architect
 *      ├─ subject_prompt ─┐
 *      ├─ scene_prompt   ─┤ → 3 parallel intermediate image calls
 *      ├─ style_prompt   ─┘
 *      ├─ master_prompt  ──► FUSION call: takes 3 intermediates + master
 *      │                                  prompt → final master image
 *      └─ logo_prompt    ──► standalone logo image call
 *                         → sharp → persist
 *
 * Total Gemini image calls: 5 (3 intermediates + 1 fusion + 1 logo).
 * Intermediates are persisted as standalone Assets too (kind=image,
 * variantRole=null) so the customer can inspect them in the library +
 * regenerate any one slot without re-running the whole pipeline.
 */
import { fuseImages, renderImage } from "./image-generator";
import { persistGeneratedImage } from "./asset-persistence";
import type { CampaignPlan } from "./architect";
import type { AdBrief } from "./types";
import type { GeneratedAssetIds } from "./pipeline-shared";

export async function runModularPipeline(
  brief: AdBrief,
  plan: CampaignPlan,
  opts: { userId: string; accountId: string | null },
): Promise<GeneratedAssetIds> {
  // Stage 1: render subject + scene + style intermediates in parallel
  // (and start the logo gen in parallel too — it's independent).
  const [subjectImg, sceneImg, styleImg, logoImg] = await Promise.all([
    renderImage(plan.prompts.subject),
    renderImage(plan.prompts.scene),
    renderImage(plan.prompts.style),
    renderImage(plan.prompts.logo),
  ]);

  // Persist intermediates as inspectable Assets in the library. These
  // are non-role assets (no variantRole), so they won't be picked by
  // the PMAX adapter — they're just artifacts the customer can browse.
  await Promise.all([
    persistGeneratedImage(subjectImg, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: false,
      label: `AI · ${brief.brandName} · intermediate: subject`,
      auditSource: "pipeline-modular:subject",
    }),
    persistGeneratedImage(sceneImg, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: false,
      label: `AI · ${brief.brandName} · intermediate: scene`,
      auditSource: "pipeline-modular:scene",
    }),
    persistGeneratedImage(styleImg, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: false,
      label: `AI · ${brief.brandName} · intermediate: style`,
      auditSource: "pipeline-modular:style",
    }),
  ]);

  // Stage 2: fusion — the master prompt with all 3 intermediates as
  // reference images. The prompt names them by position.
  const fusionPrompt = `${plan.prompts.master}

Reference images supplied with this request, in order:
  1. SUBJECT — use this as the visual identity of the hero element.
  2. SCENE   — use this as the setting / background composition reference.
  3. STYLE   — use this as the color palette, mood, and visual treatment reference.

Synthesize ONE final ad canvas combining all three references per the master prompt above. Do not collage them — produce a single cohesive image. Apply the hard rules in the master prompt (no text, no CTA, no chrome, safe-zone composition, single dominant brand color).`;

  const fusedMaster = await fuseImages(fusionPrompt, [
    { bytes: subjectImg.bytes, mimeType: subjectImg.mimeType },
    { bytes: sceneImg.bytes, mimeType: sceneImg.mimeType },
    { bytes: styleImg.bytes, mimeType: styleImg.mimeType },
  ]);

  // Stage 3: persist fused master + logo, assign role slots.
  const [masterParentId, logoParentId] = await Promise.all([
    persistGeneratedImage(fusedMaster, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: false,
      label: `AI · ${brief.brandName} · master (refined)`,
      auditSource: "pipeline-modular:fusion",
    }),
    persistGeneratedImage(logoImg, {
      userId: opts.userId,
      accountId: opts.accountId,
      isLogo: true,
      label: `AI · ${brief.brandName} · logo (refined)`,
      auditSource: "pipeline-modular:logo",
    }),
  ]);

  return {
    marketingImageAssetId: masterParentId,
    squareMarketingImageAssetId: masterParentId,
    portraitMarketingImageAssetId: masterParentId,
    logoAssetId: logoParentId,
    landscapeLogoAssetId: logoParentId,
  };
}
