"use server";

/**
 * Black-box ad preview action.
 *
 * One call:  brief → architect → fast pipeline → copy → renderable result.
 *
 * The caller (preview-form.tsx) feeds the result into mock Google
 * placements (Search SERP, Display banner, Discover card) so the
 * customer sees how their ad will look on Google — without ever seeing
 * the pipeline behind it.
 */
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { planCampaign } from "@/lib/ai/architect";
import { GeminiKeyError } from "@/lib/ai/gemini-client";
import { generateCopyForBrief } from "@/lib/ai/pipeline";
import { runSimplePipeline } from "@/lib/ai/pipeline-simple";
import type { AdBrief } from "@/lib/ai/types";

export type PreviewResult =
  | {
      ok: true;
      copy: {
        businessName: string;
        headlines: string[];        // up to 3 (for SERP titles + sitelinks)
        longHeadline: string | null;
        descriptions: string[];     // up to 2
      };
      assetIds: {
        marketingImageAssetId?: string;
        squareMarketingImageAssetId?: string;
        portraitMarketingImageAssetId?: string;
        logoAssetId?: string;
      };
      meta: {
        sector: string;
        packLabel: string;
        brandName: string;
        landingDomain: string;
      };
    }
  | { ok: false; error: string };

export async function generatePreviewAction(input: {
  brandName: string;
  productDescription: string;
  landingPageUrl?: string;
}): Promise<PreviewResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };
  if (session.user.role === "demo") {
    return { ok: false, error: "Demo users can't generate previews." };
  }

  const brandName = input.brandName.trim();
  const productDescription = input.productDescription.trim();
  if (!brandName || !productDescription) {
    return { ok: false, error: "Fill in brand name and description." };
  }
  if (brandName.length > 50) {
    return { ok: false, error: "Brand name must be under 50 characters." };
  }

  const brief: AdBrief = {
    channel: "PMAX",
    brandName,
    productDescription,
    landingPageUrl: input.landingPageUrl?.trim() ?? "",
  };

  try {
    // Architect plans once; both downstream calls reuse the plan
    // implicitly — copy gen uses the brief directly, pipeline takes the
    // plan.
    const plan = await planCampaign(brief);

    const [copy, ids] = await Promise.all([
      generateCopyForBrief(brief),
      runSimplePipeline(brief, plan, {
        userId: session.user.id,
        accountId: null,
      }),
    ]);

    if (copy.channel !== "PMAX") {
      return { ok: false, error: "Unexpected copy channel returned." };
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ai.preview_generate",
        targetKind: "campaign",
        targetId: null,
        payload: {
          brandName,
          sector: plan.sector,
          packId: plan.pack.id,
          packMode: plan.pack.mode,
        },
      },
    });

    return {
      ok: true,
      copy: {
        businessName: copy.copy.businessName,
        headlines: copy.copy.headlines.slice(0, 3),
        longHeadline: copy.copy.longHeadlines[0] ?? null,
        descriptions: copy.copy.descriptions.slice(0, 2),
      },
      assetIds: ids,
      meta: {
        sector: plan.sector,
        packLabel: plan.pack.label,
        brandName,
        landingDomain: extractDomain(brief.landingPageUrl) ?? `${slugifyDomain(brandName)}.com`,
      },
    };
  } catch (e) {
    if (e instanceof GeminiKeyError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Preview generation failed.",
    };
  }
}

function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function slugifyDomain(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}
