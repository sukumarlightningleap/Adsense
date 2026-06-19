/**
 * Types shared between the simple + modular pipelines so they can be
 * dispatched uniformly from the router (`pipeline.ts`).
 */

export type GeneratedAssetIds = {
  logoAssetId?: string;
  landscapeLogoAssetId?: string;
  marketingImageAssetId?: string;
  squareMarketingImageAssetId?: string;
  portraitMarketingImageAssetId?: string;
};

export type PipelineMode = "fast" | "refined";
