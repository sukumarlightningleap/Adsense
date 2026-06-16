/**
 * Campaign create wizard — shape + Zod validation.
 *
 * The wizard accumulates a `CampaignDraft` across 5 steps:
 *   1. Account + Book details
 *   2. Audience + geo
 *   3. Ad copy
 *   4. Budget + bidding
 *   5. Review
 *
 * Each step has its own per-step Zod schema (used by the Next/Back gate
 * so a user can't advance with invalid data). The final save uses
 * `FullDraftSchema` for end-to-end validation in the server action.
 *
 * Asset/image step (originally step 5 in the Python project) is deferred
 * to Phase 5 when the nano-banana image pipeline lands. Channel is
 * therefore hard-coded to SEARCH for now.
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

// ---------------------------------------------------------------------------
// Per-step schemas — used to gate Next/Back transitions in the wizard.
// ---------------------------------------------------------------------------
export const Step1Schema = z.object({
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

export const Step3Schema = z.object({
  adCopy: z.object({
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
  }),
});

export const Step4Schema = z
  .object({
    budget: z.object({
      dailyUsd: z
        .number()
        .min(1, "Min $1/day")
        .max(10000, "Max $10,000/day — raise the launcher cap in .env if you need more"),
      biddingStrategy: z.enum([
        "MAXIMIZE_CLICKS",
        "MAXIMIZE_CONVERSIONS",
        "TARGET_CPA",
      ]),
      maxCpcUsd: z.number().positive().optional(),
      targetCpaUsd: z.number().positive().optional(),
    }),
  })
  .refine(
    (d) =>
      d.budget.biddingStrategy !== "TARGET_CPA" ||
      (d.budget.targetCpaUsd != null && d.budget.targetCpaUsd > 0),
    {
      message: "Target CPA requires a positive target CPA value",
      path: ["budget", "targetCpaUsd"],
    },
  );

// ---------------------------------------------------------------------------
// Full draft — composes all per-step schemas into one validated shape.
// ---------------------------------------------------------------------------
export const FullDraftSchema = Step1Schema.and(Step2Schema)
  .and(Step3Schema)
  .and(Step4Schema);

export type CampaignDraft = z.infer<typeof FullDraftSchema>;

/**
 * Initial empty draft. Used to bootstrap the wizard and as the fallback
 * when localStorage is empty / corrupt.
 */
export function emptyDraft(): CampaignDraft {
  return {
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
    adCopy: {
      headlines: [],
      descriptions: [],
      keywords: [],
      negativeKeywords: [],
    },
    budget: {
      dailyUsd: 10,
      biddingStrategy: "MAXIMIZE_CLICKS",
      maxCpcUsd: undefined,
      targetCpaUsd: undefined,
    },
  };
}
