/**
 * End-to-end content pipeline.
 *
 * Two entry points:
 *
 *   - `generateCopyForBrief`    → text only (fast, ~1-3s).
 *   - `generateAssetsForBrief`  → images via either pipeline (fast or
 *                                 refined), resized + persisted as Asset
 *                                 rows. Returns the per-role asset IDs.
 *
 * For images, this file is a thin router on top of:
 *   - `pipeline-simple.ts`   (fast: 2 image calls)
 *   - `pipeline-modular.ts`  (refined: 5 image calls, Whisk-style)
 *
 * Pick the mode via `opts.mode` — defaults to "fast" (the cheap path).
 */
import { db } from "@/lib/db";

import { planCampaign } from "./architect";
import { generatePmaxCopy, generateSearchCopy } from "./copy-generator";
import { runModularPipeline } from "./pipeline-modular";
import { runSimplePipeline } from "./pipeline-simple";
import type {
  GeneratedAssetIds,
  PipelineMode,
} from "./pipeline-shared";
import type {
  AdBrief,
  GeneratedPmaxCopy,
  GeneratedSearchCopy,
} from "./types";

export type { GeneratedAssetIds, PipelineMode } from "./pipeline-shared";

export type GeneratedCopy =
  | { channel: "SEARCH"; copy: GeneratedSearchCopy }
  | { channel: "PMAX"; copy: GeneratedPmaxCopy };

export async function generateCopyForBrief(
  brief: AdBrief,
): Promise<GeneratedCopy> {
  if (brief.channel === "PMAX") {
    return { channel: "PMAX", copy: await generatePmaxCopy(brief) };
  }
  return { channel: "SEARCH", copy: await generateSearchCopy(brief) };
}

export type GenerateAssetsOpts = {
  userId: string;
  accountId?: string | null;
  /** "fast" = 2 calls, "refined" = 5 calls. Default: "fast". */
  mode?: PipelineMode;
};

/**
 * Plan the campaign (architect picks style pack + writes prompts), then
 * dispatch to the chosen pipeline. Both pipelines return the same
 * per-role asset ID shape — the wizard doesn't care which produced them.
 */
export async function generateAssetsForBrief(
  brief: AdBrief,
  opts: GenerateAssetsOpts,
): Promise<GeneratedAssetIds> {
  const mode: PipelineMode = opts.mode ?? "fast";
  const accountId = opts.accountId ?? null;

  const plan = await planCampaign(brief);

  // Audit-log the plan up-front so we can debug bad outputs without
  // re-running the architect call.
  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "ai.campaign_plan",
      targetKind: "campaign",
      targetId: null,
      payload: {
        mode,
        sector: plan.sector,
        packId: plan.pack.id,
        packMode: plan.pack.mode,
        brandName: brief.brandName,
        promptLengths: {
          master: plan.prompts.master.length,
          subject: plan.prompts.subject.length,
          scene: plan.prompts.scene.length,
          style: plan.prompts.style.length,
          logo: plan.prompts.logo.length,
        },
      },
    },
  });

  if (mode === "refined") {
    return runModularPipeline(brief, plan, { userId: opts.userId, accountId });
  }
  return runSimplePipeline(brief, plan, { userId: opts.userId, accountId });
}
