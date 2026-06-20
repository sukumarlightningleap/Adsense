/**
 * Google Ads Performance Max adapter.
 *
 * Different shape from SEARCH:
 *   - PMAX uses ASSET GROUPS, not ad groups
 *   - Assets are uploaded inline (text + image) before the asset group
 *     is created
 *   - The asset group + all its required AssetGroupAssets MUST be created
 *     in a single bulk_mutate (Google enforces minimum asset counts
 *     atomically — partial-failure is NOT supported)
 *   - Bidding strategies are CONVERSION-based only (no target_spend)
 *   - No network_settings — PMAX serves on every network by default
 *
 * Order of operations:
 *   1. CampaignBudget               (explicitly_shared=false; PMAX requires)
 *   2. Campaign                      (channel=PERFORMANCE_MAX, bidding oneof)
 *   3. Asset.create                  (batched: all text + image at once)
 *   4. mutateResources (bulk_mutate) (AssetGroup + every AssetGroupAsset
 *                                     linking required assets — atomic)
 *   5. CampaignCriterion             (geo targets — same as SEARCH)
 *
 * Minimums (per Google's PMAX rules, brand-guidelines disabled):
 *   - 3-15 HEADLINE (≤30 chars)
 *   - 1-5  LONG_HEADLINE (≤90 chars)
 *   - 2-5  DESCRIPTION (≤90 chars)
 *   - 1    BUSINESS_NAME (≤25 chars)
 *   - 1-5  LOGO (1:1)
 *   - 1-20 MARKETING_IMAGE (1.91:1)
 *   - 1-20 SQUARE_MARKETING_IMAGE (1:1)
 *
 * Hard safety: every campaign is PAUSED on Google regardless of payload.
 */
import { enums, type Customer } from "google-ads-api";

import { db } from "@/lib/db";
import type { AssetRole } from "@/lib/ads/types";
import type { PmaxLaunchPayload } from "@/lib/wizard/payload-builder";

import { resolveGeo } from "./geo";
import type { LaunchResult, OperationSummary } from "./adapter";

/** Negative temp IDs for cross-references inside a bulk_mutate. */
const ASSET_GROUP_TEMP_ID = -1;

type FieldRole =
  | "HEADLINE"
  | "LONG_HEADLINE"
  | "DESCRIPTION"
  | "BUSINESS_NAME"
  | "LOGO"
  | "LANDSCAPE_LOGO"
  | "MARKETING_IMAGE"
  | "SQUARE_MARKETING_IMAGE"
  | "PORTRAIT_MARKETING_IMAGE";

type CreatedAsset = {
  resourceName: string;
  role: FieldRole;
};

export async function launchPmaxCampaign(args: {
  customer: Customer;
  payload: PmaxLaunchPayload;
  /** Numeric customer ID (dashes already stripped). */
  customerId: string;
}): Promise<LaunchResult> {
  const { customer, payload, customerId } = args;

  // 0. Geo resolution — fails fast on invalid city names
  const geoConstants = await resolveGeo(payload.geo, customer);

  // 1. Budget
  const budgetResourceName = await createBudget(customer, payload);

  // 2. Campaign
  const campaignResourceName = await createCampaign(
    customer,
    payload,
    budgetResourceName,
  );
  const campaignId = campaignResourceName.split("/").pop()!;

  // 4. Image assets — fetched from our DB (variants matched by role).
  //    Created ONCE and shared across every asset group when this is a
  //    multi-asset-group campaign (Phase A5). Image assets are global
  //    to the customer in Google's model, so we can link the same one
  //    into multiple AssetGroups via per-group AssetGroupAsset rows.
  const imageAssets = await createImageAssets(customer, payload);

  // 3 + 5. Text assets + AssetGroup creation. Two branches:
  //   • payload.asset_groups present → Phase A5 multi-asset-group flow
  //   • otherwise                    → legacy single-asset-group flow
  let totalTextAssetCount = 0;
  let assetGroupCount = 1;
  if (payload.asset_groups && payload.asset_groups.length > 0) {
    assetGroupCount = payload.asset_groups.length;
    for (const cluster of payload.asset_groups) {
      const clusterTextAssets = await createTextAssetsFromCluster(
        customer,
        cluster,
      );
      totalTextAssetCount += clusterTextAssets.length;
      await createAssetGroupWithAssetsNamed({
        customer,
        customerId,
        campaignResourceName,
        finalUrl: payload.book.landing_page_url,
        nameSuffix: cluster.theme_label,
        allAssets: [...clusterTextAssets, ...imageAssets],
      });
    }
  } else {
    // Legacy single-asset-group flow — unchanged
    const textAssets = await createTextAssets(customer, payload);
    totalTextAssetCount = textAssets.length;
    await createAssetGroupWithAssets({
      customer,
      customerId,
      campaignResourceName,
      payload,
      allAssets: [...textAssets, ...imageAssets],
    });
  }

  // 6. Geo criteria (campaign-level, same as SEARCH)
  await createGeoCriteria(customer, campaignResourceName, geoConstants);

  return {
    providerCampaignId: campaignId,
    resourceName: campaignResourceName,
    status: "PAUSED",
    operations: summarize(payload, {
      geoCount: geoConstants.length,
      textAssetCount: totalTextAssetCount,
      imageAssetCount: imageAssets.length,
      assetGroupCount,
    }),
  };
}

// ---------------------------------------------------------------------------
// 3b. Text assets from a single cluster (Phase A5 multi-asset-group).
// Each cluster has its own headlines/long_headlines/descriptions/business_name,
// so each cluster needs its own pool of TEXT assets.
// ---------------------------------------------------------------------------
async function createTextAssetsFromCluster(
  customer: Customer,
  cluster: {
    headlines: string[];
    long_headlines: string[];
    descriptions: string[];
    business_name: string;
  },
): Promise<CreatedAsset[]> {
  type Spec = { text: string; role: FieldRole };
  const specs: Spec[] = [
    ...cluster.headlines.map(
      (t): Spec => ({ text: t.slice(0, 30), role: "HEADLINE" }),
    ),
    ...cluster.long_headlines.map(
      (t): Spec => ({ text: t.slice(0, 90), role: "LONG_HEADLINE" }),
    ),
    ...cluster.descriptions.map(
      (t): Spec => ({ text: t.slice(0, 90), role: "DESCRIPTION" }),
    ),
    {
      text: cluster.business_name.slice(0, 25),
      role: "BUSINESS_NAME",
    },
  ];

  const result = await customer.assets.create(
    specs.map(
      (s) =>
        ({
          text_asset: { text: s.text },
        }) as Parameters<typeof customer.assets.create>[0][number],
    ),
  );

  return specs.map((s, i) => {
    const rn = result.results[i]?.resource_name;
    if (!rn) throw new Error(`Failed to create cluster text asset (${s.role})`);
    return { resourceName: rn, role: s.role };
  });
}

// ---------------------------------------------------------------------------
// 5b. AssetGroup + AssetGroupAssets (atomic bulk_mutate) — version that
// takes a name suffix + explicit final URL so each cluster can produce
// its own named asset group like "Ikigai · Researcher AssetGroup".
// Each call uses temp ID -1 inside its own mutate, which is safe because
// every mutate is independent.
// ---------------------------------------------------------------------------
async function createAssetGroupWithAssetsNamed({
  customer,
  customerId,
  campaignResourceName,
  finalUrl,
  nameSuffix,
  allAssets,
}: {
  customer: Customer;
  customerId: string;
  campaignResourceName: string;
  finalUrl: string;
  nameSuffix: string;
  allAssets: CreatedAsset[];
}): Promise<void> {
  const assetGroupTempName = `customers/${customerId}/assetGroups/${ASSET_GROUP_TEMP_ID}`;
  const safeSuffix = nameSuffix.slice(0, 40).replace(/[^\w\s\-·]/g, "");

  type MutateOp = {
    entity: string;
    operation: "create";
    resource: Record<string, unknown>;
  };
  const operations: MutateOp[] = [
    {
      entity: "asset_group",
      operation: "create",
      resource: {
        resource_name: assetGroupTempName,
        name: `${safeSuffix} AssetGroup`.slice(0, 80),
        campaign: campaignResourceName,
        final_urls: [finalUrl],
        final_mobile_urls: [finalUrl],
        status: enums.AssetGroupStatus.PAUSED,
      },
    },
  ];

  for (const { resourceName, role } of allAssets) {
    const fieldType = (
      enums.AssetFieldType as unknown as Record<string, number>
    )[role];
    if (fieldType == null) {
      throw new Error(`Unknown AssetFieldType: ${role}`);
    }
    operations.push({
      entity: "asset_group_asset",
      operation: "create",
      resource: {
        asset_group: assetGroupTempName,
        asset: resourceName,
        field_type: fieldType,
      },
    });
  }

  await (
    customer as unknown as {
      mutateResources: (ops: unknown[]) => Promise<unknown>;
    }
  ).mutateResources(operations);
}

// ---------------------------------------------------------------------------
// 1. Budget
// ---------------------------------------------------------------------------
async function createBudget(
  customer: Customer,
  payload: PmaxLaunchPayload,
): Promise<string> {
  const namePrefix = (payload.book.title || "PMAX").slice(0, 40);
  const result = await customer.campaignBudgets.create([
    {
      name: `${namePrefix} PMAX Budget ${randomToken(3)}`,
      amount_micros: Math.round(payload.budget.daily_usd * 1_000_000),
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
      // PMAX cannot use a shared budget — Google rejects.
      explicitly_shared: false,
    },
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create PMAX CampaignBudget");
  return rn;
}

// ---------------------------------------------------------------------------
// 2. Campaign
// ---------------------------------------------------------------------------
async function createCampaign(
  customer: Customer,
  payload: PmaxLaunchPayload,
  budgetResourceName: string,
): Promise<string> {
  const title = (payload.book.title || "Untitled").slice(0, 60);

  // Build the bidding-strategy oneof for PMAX:
  //   MAXIMIZE_CONVERSIONS        — bare {} or { target_cpa_micros }
  //   MAXIMIZE_CONVERSION_VALUE   — bare {} or { target_roas }
  //   TARGET_CPA                  — { target_cpa_micros } (required)
  //   TARGET_ROAS                 — { target_roas } (required)
  const biddingFields: Record<string, unknown> = {};
  switch (payload.budget.bidding_strategy) {
    case "MAXIMIZE_CONVERSIONS":
      biddingFields.maximize_conversions =
        payload.budget.target_cpa_usd != null
          ? {
              target_cpa_micros: Math.round(
                payload.budget.target_cpa_usd * 1_000_000,
              ),
            }
          : {};
      break;
    case "MAXIMIZE_CONVERSION_VALUE":
      biddingFields.maximize_conversion_value =
        payload.budget.target_roas != null
          ? { target_roas: payload.budget.target_roas }
          : {};
      break;
    case "TARGET_CPA":
      biddingFields.target_cpa = {
        target_cpa_micros: Math.round(
          (payload.budget.target_cpa_usd ?? 0) * 1_000_000,
        ),
      };
      break;
    case "TARGET_ROAS":
      biddingFields.target_roas = {
        target_roas: payload.budget.target_roas ?? 1.0,
      };
      break;
    default:
      throw new Error(
        `Unsupported PMAX bidding strategy: ${String(payload.budget.bidding_strategy)}`,
      );
  }

  const result = await customer.campaigns.create([
    {
      name: `${title} — PMAX`,
      campaign_budget: budgetResourceName,
      // PMAX-specific channel — sub-type must NOT be set.
      advertising_channel_type: enums.AdvertisingChannelType.PERFORMANCE_MAX,
      // SAFETY: PAUSED-on-Google regardless of payload.launch_status.
      status: enums.CampaignStatus.PAUSED,
      // Required since 2024 — same as SEARCH.
      contains_eu_political_advertising:
        enums.EuPoliticalAdvertisingStatus
          .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
      // Brand guidelines disabled — simpler asset linking (all at
      // AssetGroup level, no CampaignAsset). When enabled, BUSINESS_NAME
      // + LOGO + LANDSCAPE_LOGO would need CampaignAsset linking too.
      brand_guidelines_enabled: false,
      // No network_settings for PMAX — serves on all networks by default.
      ...biddingFields,
    } as Parameters<typeof customer.campaigns.create>[0][number],
  ]);
  const rn = result.results[0]?.resource_name;
  if (!rn) throw new Error("Failed to create PMAX Campaign");
  return rn;
}

// ---------------------------------------------------------------------------
// 3. Text assets — batched create in a single call
// ---------------------------------------------------------------------------
async function createTextAssets(
  customer: Customer,
  payload: PmaxLaunchPayload,
): Promise<CreatedAsset[]> {
  type Spec = { text: string; role: FieldRole };
  const specs: Spec[] = [
    ...payload.ad_copy.headlines.map(
      (t): Spec => ({ text: t.slice(0, 30), role: "HEADLINE" }),
    ),
    ...payload.ad_copy.long_headlines.map(
      (t): Spec => ({ text: t.slice(0, 90), role: "LONG_HEADLINE" }),
    ),
    ...payload.ad_copy.descriptions.map(
      (t): Spec => ({ text: t.slice(0, 90), role: "DESCRIPTION" }),
    ),
    {
      text: payload.ad_copy.business_name.slice(0, 25),
      role: "BUSINESS_NAME",
    },
  ];

  const result = await customer.assets.create(
    specs.map(
      (s) =>
        ({
          text_asset: { text: s.text },
        }) as Parameters<typeof customer.assets.create>[0][number],
    ),
  );

  return specs.map((s, i) => {
    const rn = result.results[i]?.resource_name;
    if (!rn) throw new Error(`Failed to create text asset (${s.role})`);
    return { resourceName: rn, role: s.role };
  });
}

// ---------------------------------------------------------------------------
// 4. Image assets — fetch from our DB + upload inline
// ---------------------------------------------------------------------------
async function createImageAssets(
  customer: Customer,
  payload: PmaxLaunchPayload,
): Promise<CreatedAsset[]> {
  if (!payload.assets) {
    throw new Error(
      "PMAX payload has no `assets` block. Attach assets in the wizard.",
    );
  }

  type Picked = { pickedId: string; role: FieldRole };
  const picks: Picked[] = [];
  if (payload.assets.logo_asset_id) {
    picks.push({ pickedId: payload.assets.logo_asset_id, role: "LOGO" });
  }
  if (payload.assets.landscape_logo_asset_id) {
    picks.push({
      pickedId: payload.assets.landscape_logo_asset_id,
      role: "LANDSCAPE_LOGO",
    });
  }
  if (payload.assets.marketing_image_asset_id) {
    picks.push({
      pickedId: payload.assets.marketing_image_asset_id,
      role: "MARKETING_IMAGE",
    });
  }
  if (payload.assets.square_marketing_image_asset_id) {
    picks.push({
      pickedId: payload.assets.square_marketing_image_asset_id,
      role: "SQUARE_MARKETING_IMAGE",
    });
  }
  if (payload.assets.portrait_marketing_image_asset_id) {
    picks.push({
      pickedId: payload.assets.portrait_marketing_image_asset_id,
      role: "PORTRAIT_MARKETING_IMAGE",
    });
  }

  if (picks.length === 0) {
    throw new Error(
      "PMAX requires at least 1 logo, 1 marketing image, and 1 square marketing image.",
    );
  }

  // Resolve each picked asset to the right variant (the user picks the
  // ORIGINAL; we auto-fetch the size that matches the PMAX field type).
  const resolved = await Promise.all(picks.map(resolveAssetForRole));

  // Upload all images in one batched create
  const result = await customer.assets.create(
    resolved.map(
      ({ bytes }) =>
        ({
          image_asset: { data: Buffer.from(new Uint8Array(bytes)) },
        }) as Parameters<typeof customer.assets.create>[0][number],
    ),
  );

  return resolved.map(({ role }, i) => {
    const rn = result.results[i]?.resource_name;
    if (!rn) throw new Error(`Failed to create image asset (${role})`);
    return { resourceName: rn, role };
  });
}

/**
 * Resolve a picked Asset ID to the right BYTES for a Google Ads role.
 *
 *   - If the user picked a variant directly (parentAssetId NOT NULL), use it.
 *   - If they picked the original (parentAssetId NULL), find the child
 *     variant whose `variantRole` matches the Google Ads role.
 *   - If no matching variant exists, fall back to the original bytes
 *     (Google may reject for aspect ratio — we surface that as SDK error).
 */
async function resolveAssetForRole({
  pickedId,
  role,
}: {
  pickedId: string;
  role: FieldRole;
}): Promise<{
  role: FieldRole;
  bytes: Uint8Array;
}> {
  const ROLE_TO_VARIANT_ROLE: Partial<Record<FieldRole, AssetRole>> = {
    LOGO: "square_logo",
    LANDSCAPE_LOGO: "landscape_logo",
    MARKETING_IMAGE: "marketing_image",
    SQUARE_MARKETING_IMAGE: "square_marketing_image",
    PORTRAIT_MARKETING_IMAGE: "portrait_marketing_image",
  };

  const picked = await db.asset.findUnique({
    where: { id: pickedId },
    select: { id: true, bytes: true, parentAssetId: true },
  });
  if (!picked) {
    throw new Error(`Asset ${pickedId} not found in your library`);
  }

  // Already a variant — use it directly.
  if (picked.parentAssetId !== null) {
    return { role, bytes: picked.bytes };
  }

  // User picked the original — find the matching variant.
  const variantRole = ROLE_TO_VARIANT_ROLE[role];
  if (!variantRole) {
    return { role, bytes: picked.bytes };
  }

  const variant = await db.asset.findFirst({
    where: { parentAssetId: pickedId, variantRole },
    select: { bytes: true },
  });
  if (variant) {
    return { role, bytes: variant.bytes };
  }
  // Fall through: no variant — Google may complain, but better than crash.
  return { role, bytes: picked.bytes };
}

// ---------------------------------------------------------------------------
// 5. AssetGroup + AssetGroupAssets (atomic bulk_mutate)
// ---------------------------------------------------------------------------
async function createAssetGroupWithAssets({
  customer,
  customerId,
  campaignResourceName,
  payload,
  allAssets,
}: {
  customer: Customer;
  customerId: string;
  campaignResourceName: string;
  payload: PmaxLaunchPayload;
  allAssets: CreatedAsset[];
}): Promise<void> {
  const assetGroupTempName = `customers/${customerId}/assetGroups/${ASSET_GROUP_TEMP_ID}`;
  const title = (payload.book.title || "Untitled").slice(0, 40);

  // Build mutate operations — the Opteo SDK's `mutateResources` accepts
  // a flat array of typed operation objects. Per Google's PMAX rules, the
  // AssetGroup and every AssetGroupAsset linking the required assets MUST
  // ship in one call (no partial-failure).
  type MutateOp = {
    entity: string;
    operation: "create";
    resource: Record<string, unknown>;
  };
  const operations: MutateOp[] = [
    {
      entity: "asset_group",
      operation: "create",
      resource: {
        resource_name: assetGroupTempName,
        name: `${title} AssetGroup`,
        campaign: campaignResourceName,
        final_urls: [payload.book.landing_page_url],
        final_mobile_urls: [payload.book.landing_page_url],
        status: enums.AssetGroupStatus.PAUSED,
      },
    },
  ];

  for (const { resourceName, role } of allAssets) {
    const fieldType = (
      enums.AssetFieldType as unknown as Record<string, number>
    )[role];
    if (fieldType == null) {
      throw new Error(`Unknown AssetFieldType: ${role}`);
    }
    operations.push({
      entity: "asset_group_asset",
      operation: "create",
      resource: {
        asset_group: assetGroupTempName,
        asset: resourceName,
        field_type: fieldType,
      },
    });
  }

  // Cast to bypass Opteo's runtime-flexible types here — the operation
  // shape is exactly what the proto expects.
  await (
    customer as unknown as {
      mutateResources: (ops: unknown[]) => Promise<unknown>;
    }
  ).mutateResources(operations);
}

// ---------------------------------------------------------------------------
// 6. Geo criteria
// ---------------------------------------------------------------------------
async function createGeoCriteria(
  customer: Customer,
  campaignResourceName: string,
  geoConstants: string[],
): Promise<void> {
  if (geoConstants.length === 0) return;
  await customer.campaignCriteria.create(
    geoConstants.map((geoConst) => ({
      campaign: campaignResourceName,
      location: { geo_target_constant: geoConst },
    })),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomToken(bytes: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < bytes * 2; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function summarize(
  payload: PmaxLaunchPayload,
  counts: {
    geoCount: number;
    textAssetCount: number;
    imageAssetCount: number;
    assetGroupCount?: number;
  },
): OperationSummary[] {
  return [
    { type: "CampaignBudget", detail: { daily_usd: payload.budget.daily_usd } },
    {
      type: "Campaign",
      detail: {
        name: payload.book.title,
        channel: payload.channel,
        status: "PAUSED",
        bidding: payload.budget.bidding_strategy,
        brand_guidelines: false,
      },
    },
    {
      type: "TextAssets",
      detail: {
        headlines: payload.ad_copy.headlines.length,
        long_headlines: payload.ad_copy.long_headlines.length,
        descriptions: payload.ad_copy.descriptions.length,
        business_name: payload.ad_copy.business_name,
        total: counts.textAssetCount,
      },
    },
    {
      type: "ImageAssets",
      detail: {
        total: counts.imageAssetCount,
      },
    },
    {
      type: "AssetGroup",
      detail: {
        count: counts.assetGroupCount ?? 1,
        labels:
          payload.asset_groups?.map((g) => g.theme_label) ?? [
            payload.book.title,
          ],
        final_url: payload.book.landing_page_url,
      },
    },
    {
      type: "GeoCriteria",
      detail: {
        scope: payload.geo.scope,
        country: payload.geo.country,
        resolved_count: counts.geoCount,
      },
    },
  ];
}
