/**
 * Campaign create wizard — shape + Zod validation.
 *
 * Supports two channels:
 *
 *   - SEARCH (Phase 3+):  headlines + descriptions + keywords, target_spend
 *                         / target_cpa / maximize_conversions bidding.
 *   - PMAX   (Phase 6+):  short + long headlines + descriptions + business
 *                         name; maximize_conversions / maximize_conversion_value
 *                         / target_cpa / target_roas bidding; required asset
 *                         minimums enforced on Day 4 preflight.
 *
 * The draft carries a `channel` discriminator and per-channel field shapes
 * live under `searchAdCopy` / `pmaxAdCopy` and `searchBudget` / `pmaxBudget`.
 * This keeps the type clean and lets per-step schemas branch precisely.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Supported countries — keep tight; expand when we hit a real client request.
// ---------------------------------------------------------------------------
export const SUPPORTED_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IN", name: "India" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "JP", name: "Japan" },
] as const;

export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number]["code"];

const COUNTRY_CODES = SUPPORTED_COUNTRIES.map((c) => c.code) as [
  CountryCode,
  ...CountryCode[],
];

export const CHANNELS = ["SEARCH", "PMAX"] as const;
export type Channel = (typeof CHANNELS)[number];

export const SEARCH_BIDDING_STRATEGIES = [
  "MAXIMIZE_CLICKS",
  "MAXIMIZE_CONVERSIONS",
  "TARGET_CPA",
] as const;

export const PMAX_BIDDING_STRATEGIES = [
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_CPA",
  "TARGET_ROAS",
] as const;

// ---------------------------------------------------------------------------
// Per-step schemas — used to gate Next/Back transitions in the wizard.
// ---------------------------------------------------------------------------
export const Step1Schema = z.object({
  channel: z.enum(CHANNELS),
  accountId: z.string().min(1, "Pick an account"),
  book: z.object({
    title: z
      .string()
      .min(1, "Title is required")
      .max(255, "Keep it under 255 chars"),
    description: z
      .string()
      .min(1, "Description is required")
      .max(2000, "Keep it under 2000 chars"),
    landingPageUrl: z
      .string()
      .url("Must be a full URL (https://…)")
      .max(2000),
    isbn: z.string().optional(),
  }),
});

export const Step2Schema = z.object({
  audience: z.object({
    country: z.enum(COUNTRY_CODES),
    scope: z.enum(["nationwide", "top_metros", "specific_cities"]),
    cities: z.array(z.string().min(1)).max(50).optional(),
  }),
});

// SEARCH ad copy (headlines + descriptions + keywords + negatives).
export const SearchAdCopySchema = z.object({
  headlines: z
    .array(z.string().min(1).max(30, "Max 30 chars per Google's spec"))
    .min(3, "At least 3 headlines required")
    .max(15, "Max 15 headlines"),
  descriptions: z
    .array(z.string().min(1).max(90, "Max 90 chars per Google's spec"))
    .min(2, "At least 2 descriptions required")
    .max(4, "Max 4 descriptions"),
  keywords: z.array(z.string().min(1).max(80)).min(1, "Add at least 1 keyword"),
  negativeKeywords: z.array(z.string().min(1).max(80)).optional(),
});

/**
 * Multi-ad-group SEARCH copy (Phase A5). When the autopilot writes this
 * shape on launch, the SEARCH adapter creates ONE ad group per cluster
 * — each with its own RSA + keyword set. The legacy `SearchAdCopySchema`
 * stays around for the wizard's single-ad-group path; the schema's
 * Step3 accepts EITHER shape.
 */
export const SearchAdGroupSchema = z.object({
  themeLabel: z
    .string()
    .min(1, "Theme label required")
    .max(50, "Keep theme labels under 50 chars"),
  intent: z.string().max(500).optional(),
  headlines: z
    .array(z.string().min(1).max(30))
    .min(3, "At least 3 headlines per ad group")
    .max(15),
  descriptions: z
    .array(z.string().min(1).max(90))
    .min(2, "At least 2 descriptions per ad group")
    .max(4),
  keywords: z
    .array(z.string().min(1).max(80))
    .min(1, "At least 1 keyword per ad group")
    .max(50, "Keep ad groups tight — max 50 keywords"),
  negativeKeywords: z.array(z.string().min(1).max(80)).optional(),
});

export const SearchAdGroupsSchema = z
  .array(SearchAdGroupSchema)
  .min(1, "At least 1 ad group")
  .max(5, "Max 5 ad groups per campaign (autopilot v1)");

// PMAX ad copy (short + long headlines + descriptions + business name).
// Asset minimums from Google's PMAX requirements (May 2026):
//   - HEADLINE: ≤30 chars, 3 min, 15 max
//   - LONG_HEADLINE: ≤90 chars, 1 min, 5 max
//   - DESCRIPTION: ≤90 chars, 2 min, 5 max
//   - BUSINESS_NAME: ≤25 chars, 1 required
export const PmaxAdCopySchema = z.object({
  headlines: z
    .array(z.string().min(1).max(30, "Max 30 chars per Google's spec"))
    .min(3, "At least 3 short headlines required")
    .max(15, "Max 15 short headlines"),
  longHeadlines: z
    .array(z.string().min(1).max(90, "Max 90 chars per Google's spec"))
    .min(1, "At least 1 long headline required")
    .max(5, "Max 5 long headlines"),
  descriptions: z
    .array(z.string().min(1).max(90, "Max 90 chars per Google's spec"))
    .min(2, "At least 2 descriptions required")
    .max(5, "Max 5 descriptions"),
  businessName: z
    .string()
    .min(1, "Business name is required")
    .max(25, "Max 25 chars per Google's spec"),
});

/**
 * Multi-asset-group PMAX copy (Phase A5). The PMAX adapter creates one
 * AssetGroup per cluster; image assets are shared across all groups
 * (single campaign-wide image pool).
 */
export const PmaxAssetGroupSchema = z.object({
  themeLabel: z
    .string()
    .min(1, "Theme label required")
    .max(50, "Keep theme labels under 50 chars"),
  intent: z.string().max(500).optional(),
  headlines: z
    .array(z.string().min(1).max(30))
    .min(3, "At least 3 short headlines per asset group")
    .max(15),
  longHeadlines: z
    .array(z.string().min(1).max(90))
    .min(1, "At least 1 long headline per asset group")
    .max(5),
  descriptions: z
    .array(z.string().min(1).max(90))
    .min(2, "At least 2 descriptions per asset group")
    .max(5),
  businessName: z.string().min(1).max(25),
});

export const PmaxAssetGroupsSchema = z
  .array(PmaxAssetGroupSchema)
  .min(1, "At least 1 asset group")
  .max(3, "Max 3 asset groups per PMAX campaign (autopilot v1)");

// SEARCH budget + bidding.
export const SearchBudgetSchema = z
  .object({
    dailyUsd: z
      .number()
      .min(1, "Min $1/day")
      .max(10000, "Max $10,000/day — raise the launcher cap in .env"),
    biddingStrategy: z.enum(SEARCH_BIDDING_STRATEGIES),
    maxCpcUsd: z.number().positive().optional(),
    targetCpaUsd: z.number().positive().optional(),
  })
  .refine(
    (d) =>
      d.biddingStrategy !== "TARGET_CPA" ||
      (d.targetCpaUsd != null && d.targetCpaUsd > 0),
    {
      message: "Target CPA requires a positive target CPA value",
      path: ["targetCpaUsd"],
    },
  );

// PMAX budget + bidding. PMAX does NOT support MAXIMIZE_CLICKS (no
// `target_spend`); only conversion-based strategies are valid.
export const PmaxBudgetSchema = z
  .object({
    dailyUsd: z
      .number()
      .min(1, "Min $1/day")
      .max(10000, "Max $10,000/day — raise the launcher cap in .env"),
    biddingStrategy: z.enum(PMAX_BIDDING_STRATEGIES),
    targetCpaUsd: z.number().positive().optional(),
    targetRoas: z
      .number()
      .positive()
      .max(20, "Max 2000% (20.0) ROAS target")
      .optional(),
  })
  .refine(
    (d) =>
      d.biddingStrategy !== "TARGET_CPA" ||
      (d.targetCpaUsd != null && d.targetCpaUsd > 0),
    {
      message: "Target CPA requires a positive target CPA value",
      path: ["targetCpaUsd"],
    },
  )
  .refine(
    (d) =>
      d.biddingStrategy !== "TARGET_ROAS" ||
      (d.targetRoas != null && d.targetRoas > 0),
    {
      message:
        "Target ROAS requires a positive target value (e.g. 3.5 = 350%)",
      path: ["targetRoas"],
    },
  );

// PMAX assets — Day 3 wires the picker UI in the wizard. The Zod schema
// is permissive (every field optional) at draft time, but the dedicated
// Step5AssetsSchema below requires the 3 mandatory roles for advancing
// to Review. The launcher's preflight enforces the same check before any
// SDK call.
export const PmaxAssetsSchema = z
  .object({
    logoAssetId: z.string().optional(),
    landscapeLogoAssetId: z.string().optional(),
    marketingImageAssetId: z.string().optional(),
    squareMarketingImageAssetId: z.string().optional(),
    portraitMarketingImageAssetId: z.string().optional(),
  })
  .optional();

/**
 * Hard gate for the wizard's Assets step (PMAX only). Required role
 * picks must be present before the user can hit Review.
 */
export const Step5AssetsSchema = z.object({
  channel: z.literal("PMAX"),
  pmaxAssets: z.object({
    logoAssetId: z.string().min(1, "Pick a logo (1:1)"),
    marketingImageAssetId: z
      .string()
      .min(1, "Pick a marketing image (1.91:1)"),
    squareMarketingImageAssetId: z
      .string()
      .min(1, "Pick a square marketing image (1:1)"),
    landscapeLogoAssetId: z.string().optional(),
    portraitMarketingImageAssetId: z.string().optional(),
  }),
});

// Combined per-step schemas for the channel-aware wizard.
//
// Copy can land in one of two shapes per channel:
//   SEARCH:
//     • `searchAdCopy`     — legacy single-ad-group (the wizard still uses this)
//     • `searchAdGroups`   — Phase A5 multi-ad-group (the /app/create autopilot)
//   PMAX:
//     • `pmaxAdCopy`       — legacy single-asset-group (the wizard still uses this)
//     • `pmaxAssetGroups`  — Phase A5 multi-asset-group (autopilot)
// At least one shape must be present per channel.
export const Step3Schema = z.object({
  channel: z.enum(CHANNELS),
  searchAdCopy: SearchAdCopySchema.optional(),
  searchAdGroups: SearchAdGroupsSchema.optional(),
  pmaxAdCopy: PmaxAdCopySchema.optional(),
  pmaxAssetGroups: PmaxAssetGroupsSchema.optional(),
}).refine(
  (d) =>
    (d.channel === "SEARCH" &&
      (d.searchAdCopy ||
        (d.searchAdGroups && d.searchAdGroups.length > 0))) ||
    (d.channel === "PMAX" &&
      (d.pmaxAdCopy ||
        (d.pmaxAssetGroups && d.pmaxAssetGroups.length > 0))),
  {
    message: "Ad copy doesn't match the chosen channel",
    path: ["channel"],
  },
);

export const Step4Schema = z.object({
  channel: z.enum(CHANNELS),
  searchBudget: SearchBudgetSchema.optional(),
  pmaxBudget: PmaxBudgetSchema.optional(),
}).refine(
  (d) =>
    (d.channel === "SEARCH" && d.searchBudget) ||
    (d.channel === "PMAX" && d.pmaxBudget),
  {
    message: "Budget doesn't match the chosen channel",
    path: ["channel"],
  },
);

// ---------------------------------------------------------------------------
// Full draft — composes all per-step schemas into one validated shape.
// ---------------------------------------------------------------------------
export const FullDraftSchema = Step1Schema.and(Step2Schema)
  .and(Step3Schema)
  .and(Step4Schema)
  .and(
    z.object({
      pmaxAssets: PmaxAssetsSchema,
    }),
  );

export type CampaignDraft = z.infer<typeof FullDraftSchema>;

/**
 * Initial empty draft. Used to bootstrap the wizard and as the fallback
 * when localStorage is empty / corrupt.
 */
export function emptyDraft(): CampaignDraft {
  return {
    channel: "SEARCH",
    accountId: "",
    book: {
      title: "",
      description: "",
      landingPageUrl: "",
      isbn: undefined,
    },
    audience: {
      country: "US",
      scope: "nationwide",
      cities: [],
    },
    searchAdCopy: {
      headlines: [],
      descriptions: [],
      keywords: [],
      negativeKeywords: [],
    },
    searchAdGroups: undefined,
    pmaxAdCopy: {
      headlines: [],
      longHeadlines: [],
      descriptions: [],
      businessName: "",
    },
    pmaxAssetGroups: undefined,
    searchBudget: {
      dailyUsd: 10,
      biddingStrategy: "MAXIMIZE_CLICKS",
      maxCpcUsd: undefined,
      targetCpaUsd: undefined,
    },
    pmaxBudget: {
      dailyUsd: 10,
      biddingStrategy: "MAXIMIZE_CONVERSIONS",
      targetCpaUsd: undefined,
      targetRoas: undefined,
    },
    pmaxAssets: {
      logoAssetId: undefined,
      landscapeLogoAssetId: undefined,
      marketingImageAssetId: undefined,
      squareMarketingImageAssetId: undefined,
      portraitMarketingImageAssetId: undefined,
    },
  };
}
