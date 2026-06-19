/**
 * Account adoption importer (Phase 8a).
 *
 * Pulls everything a customer already has in Google Ads and mirrors it
 * into our DB so they can manage from Adsense without losing context.
 *
 * What we import:
 *   - Customer info  → fills AdsAccount.descriptiveName / currency / timeZone
 *   - Campaigns      → upserts Campaign rows (source='imported')
 *   - AdGroups       → upserts AdGroup rows (with single embedded RSA below)
 *   - RSAs           → folded into AdGroup row (headlines/descriptions/finalUrls)
 *   - Keywords       → upserts Keyword rows (positive + negative)
 *   - AssetGroups    → upserts AssetGroup rows (PMAX)
 *   - Asset-group
 *     text assets    → folded into AssetGroup (headlines/longHeadlines/etc.)
 *   - Conversion
 *     actions        → upserts ConversionAction rows
 *
 * What we do NOT import (yet):
 *   - Image / video / logo asset BYTES. Requires downloading from
 *     Google's CDN — a separate sweep, deferred to Phase 8a.1. For
 *     management + audit purposes we don't need bytes; we just track
 *     `providerResourceName` and let Google serve the image.
 *
 * The importer is idempotent — re-running uses provider IDs as the
 * conflict target and updates existing rows in place.
 */
import type {
  CampaignStatus,
  ChannelType,
  ConversionCategory,
  KeywordMatchType,
} from "@prisma/client";

import { db } from "@/lib/db";

import { buildCustomerForAccount } from "./client";

export type ImportResult = {
  ok: boolean;
  customerInfo: {
    descriptiveName: string | null;
    currencyCode: string | null;
    timeZone: string | null;
  };
  counts: {
    campaigns: number;
    adGroups: number;
    keywords: number;
    assetGroups: number;
    conversionActions: number;
    /** Only set when the imported account is a manager (MCC) — the
     *  number of child AdsAccount rows discovered + upserted. */
    subAccountsDiscovered?: number;
  };
  errors: string[];
  /** Whole-import duration in ms. */
  durationMs: number;
};

/**
 * Top-level entry point. Called from the "Import now" server action on
 * the account detail page.
 */
export async function importAccountData(opts: {
  accountId: string;
  userId: string;
}): Promise<ImportResult> {
  const t0 = Date.now();

  const account = await db.adsAccount.findFirst({
    where: { id: opts.accountId, userId: opts.userId, demoMode: false },
  });
  if (!account) throw new Error("Account not found or not yours.");
  // Both credential paths are supported:
  //   - `oauthRefreshToken` set → per-account token (Phase 8a)
  //   - both null              → fall back to env-based dev refresh
  //                              token (legacy / manually-added accounts)
  // `loadCredentialsForAccount` picks the right one; we just need at
  // LEAST one to be available.
  if (!account.oauthRefreshToken && !process.env.GOOGLE_ADS_TEST_REFRESH_TOKEN && !process.env.GOOGLE_ADS_REFRESH_TOKEN) {
    throw new Error(
      "No credentials available for this account. Connect via OAuth from /app/accounts/new, OR set GOOGLE_ADS_TEST_REFRESH_TOKEN / GOOGLE_ADS_REFRESH_TOKEN in .env.",
    );
  }

  const customer = buildCustomerForAccount(account);
  const errors: string[] = [];

  // --- 1. Customer info ---------------------------------------------------
  let customerInfo = {
    descriptiveName: account.descriptiveName,
    currencyCode: account.currencyCode,
    timeZone: account.timeZone,
  };
  let isManagerThisRun = account.isManager;
  try {
    const info = await pullCustomerInfo(customer);
    if (info) {
      customerInfo = {
        descriptiveName: info.descriptiveName,
        currencyCode: info.currencyCode,
        timeZone: info.timeZone,
      };
      isManagerThisRun = info.isManager;
      await db.adsAccount.update({
        where: { id: account.id },
        data: {
          descriptiveName: info.descriptiveName,
          currencyCode: info.currencyCode,
          timeZone: info.timeZone,
          isManager: info.isManager,
        },
      });
    }
  } catch (e) {
    errors.push(`customer_info: ${errMsg(e)}`);
  }

  // Manager accounts don't HAVE campaigns / ad groups / assets /
  // conversion actions of their own — those all live on client
  // sub-accounts. Instead of bailing, we use this opportunity to
  // discover the manager's children and upsert AdsAccount rows for
  // each one so the user can manage them individually. Children share
  // the manager's encrypted refresh token (same OAuth grant covers
  // all queries within the tree).
  if (isManagerThisRun) {
    let subAccountsDiscovered = 0;
    try {
      const subs = await pullSubAccounts(customer);
      for (const sub of subs) {
        // Skip self-row that customer_client emits for the manager.
        if (sub.customerId === account.customerId) continue;
        await db.adsAccount.upsert({
          where: {
            uq_account_user_provider_customer: {
              userId: opts.userId,
              provider: "google_ads",
              customerId: sub.customerId,
            },
          },
          create: {
            userId: opts.userId,
            provider: "google_ads",
            customerId: sub.customerId,
            descriptiveName: sub.descriptiveName,
            currencyCode: sub.currencyCode,
            timeZone: sub.timeZone,
            isManager: sub.isManager,
            mccCustomerId: account.customerId,
            oauthRefreshToken: account.oauthRefreshToken,
            oauthScope: account.oauthScope,
            connectionStatus: "connected",
            connectedAt: account.connectedAt ?? new Date(),
            demoMode: false,
          },
          update: {
            descriptiveName: sub.descriptiveName,
            currencyCode: sub.currencyCode,
            timeZone: sub.timeZone,
            isManager: sub.isManager,
            mccCustomerId: account.customerId,
            oauthRefreshToken: account.oauthRefreshToken,
          },
        });
        subAccountsDiscovered += 1;
      }
    } catch (e) {
      errors.push(`sub_accounts: ${errMsg(e)}`);
    }

    await db.adsAccount.update({
      where: { id: account.id },
      data: { lastImportedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        userId: opts.userId,
        action: "ads_account.import",
        targetKind: "ads_account",
        targetId: account.id,
        payload: {
          skipped: "manager_account",
          subAccountsDiscovered,
          durationMs: Date.now() - t0,
        },
      },
    });
    return {
      ok: errors.length === 0,
      customerInfo,
      counts: {
        campaigns: 0,
        adGroups: 0,
        keywords: 0,
        assetGroups: 0,
        conversionActions: 0,
        subAccountsDiscovered,
      },
      errors,
      durationMs: Date.now() - t0,
    };
  }

  // --- 2. Campaigns -------------------------------------------------------
  //
  // Build campaignId → ourId map so downstream upserts (ad groups, asset
  // groups) can resolve their FK.
  const campaignMap = new Map<string, string>();
  let campaignCount = 0;
  try {
    const { campaigns, rawCount, skippedChannels } =
      await pullCampaigns(customer);
    // Surface the diagnostic counters so the UI can show the user
    // exactly what Google returned vs. what we imported. Helps debug
    // the "Google Ads UI shows 1 campaign but importer pulls 0" case.
    if (rawCount === 0) {
      errors.push(
        `campaigns: Google returned 0 campaign rows for customer ${account.customerId} (with login_customer_id from creds). Verify the campaign is on this exact customer + your token has access.`,
      );
    } else if (rawCount > 0 && campaigns.length === 0) {
      errors.push(
        `campaigns: Google returned ${rawCount} rows but all were dropped client-side. Skipped channel types: ${skippedChannels.join(", ") || "(none)"}.`,
      );
    } else if (skippedChannels.length > 0) {
      errors.push(
        `campaigns: imported as SEARCH fallback — original channel types: ${skippedChannels.join(", ")}`,
      );
    }
    for (const c of campaigns) {
      const ourId = await upsertCampaign(account.id, c);
      campaignMap.set(c.providerCampaignId, ourId);
      campaignCount += 1;
    }
  } catch (e) {
    errors.push(`campaigns: ${errMsg(e)}`);
  }

  // --- 3. Ad groups -------------------------------------------------------
  //
  // adGroup → ourId map so RSAs + keywords can resolve their FK.
  const adGroupMap = new Map<string, string>();
  let adGroupCount = 0;
  try {
    const groups = await pullAdGroups(customer);
    for (const g of groups) {
      const ourCampaignId = campaignMap.get(g.providerCampaignId);
      if (!ourCampaignId) continue; // parent campaign skipped — ignore
      const ourId = await upsertAdGroup(ourCampaignId, g);
      adGroupMap.set(g.providerAdGroupId, ourId);
      adGroupCount += 1;
    }
  } catch (e) {
    errors.push(`ad_groups: ${errMsg(e)}`);
  }

  // --- 4. RSAs (folded into AdGroup row) ---------------------------------
  try {
    const ads = await pullRsas(customer);
    for (const a of ads) {
      const ourAdGroupId = adGroupMap.get(a.providerAdGroupId);
      if (!ourAdGroupId) continue;
      await db.adGroup.update({
        where: { id: ourAdGroupId },
        data: {
          providerAdId: a.providerAdId,
          headlines: a.headlines,
          descriptions: a.descriptions,
          finalUrls: a.finalUrls,
          path1: a.path1,
          path2: a.path2,
        },
      });
    }
  } catch (e) {
    errors.push(`rsas: ${errMsg(e)}`);
  }

  // --- 5. Keywords --------------------------------------------------------
  let keywordCount = 0;
  try {
    const kws = await pullKeywords(customer);
    for (const k of kws) {
      const ourAdGroupId = adGroupMap.get(k.providerAdGroupId);
      if (!ourAdGroupId) continue;
      await upsertKeyword(ourAdGroupId, k);
      keywordCount += 1;
    }
  } catch (e) {
    errors.push(`keywords: ${errMsg(e)}`);
  }

  // --- 6. Asset groups (PMAX) --------------------------------------------
  const assetGroupMap = new Map<string, string>();
  let assetGroupCount = 0;
  try {
    const groups = await pullAssetGroups(customer);
    for (const g of groups) {
      const ourCampaignId = campaignMap.get(g.providerCampaignId);
      if (!ourCampaignId) continue;
      const ourId = await upsertAssetGroup(ourCampaignId, g);
      assetGroupMap.set(g.providerAssetGroupId, ourId);
      assetGroupCount += 1;
    }
  } catch (e) {
    errors.push(`asset_groups: ${errMsg(e)}`);
  }

  // --- 7. Asset-group text assets (fold into AssetGroup row) ------------
  try {
    const textBuckets = await pullAssetGroupTextAssets(customer);
    for (const [providerAssetGroupId, bucket] of textBuckets) {
      const ourId = assetGroupMap.get(providerAssetGroupId);
      if (!ourId) continue;
      await db.assetGroup.update({
        where: { id: ourId },
        data: {
          headlines: bucket.headlines,
          longHeadlines: bucket.longHeadlines,
          descriptions: bucket.descriptions,
          businessName: bucket.businessName,
        },
      });
    }
  } catch (e) {
    errors.push(`asset_group_text_assets: ${errMsg(e)}`);
  }

  // --- 8. Conversion actions ---------------------------------------------
  let conversionActionCount = 0;
  try {
    const actions = await pullConversionActions(customer);
    for (const a of actions) {
      await upsertConversionAction(account.id, a);
      conversionActionCount += 1;
    }
  } catch (e) {
    errors.push(`conversion_actions: ${errMsg(e)}`);
  }

  // --- 9. Finalize -------------------------------------------------------
  await db.adsAccount.update({
    where: { id: account.id },
    data: { lastImportedAt: new Date() },
  });

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "ads_account.import",
      targetKind: "ads_account",
      targetId: account.id,
      payload: {
        campaigns: campaignCount,
        adGroups: adGroupCount,
        keywords: keywordCount,
        assetGroups: assetGroupCount,
        conversionActions: conversionActionCount,
        errorCount: errors.length,
        durationMs: Date.now() - t0,
      },
    },
  });

  return {
    ok: errors.length === 0,
    customerInfo,
    counts: {
      campaigns: campaignCount,
      adGroups: adGroupCount,
      keywords: keywordCount,
      assetGroups: assetGroupCount,
      conversionActions: conversionActionCount,
    },
    errors,
    durationMs: Date.now() - t0,
  };
}

// ===========================================================================
// GAQL pulls — each function issues one GAQL query and shapes the result
// into a flat array our upserts can iterate.
//
// Field paths follow Google Ads field reference exactly; resource-name
// joins (e.g. `ad_group.campaign`) are extracted to numeric IDs by
// `extractId()`.
// ===========================================================================

type AdsCustomer = ReturnType<typeof buildCustomerForAccount>;

/**
 * Typed GAQL helper. The Opteo SDK's `customer.query<T>()` types the
 * return as `T` (single row), but at runtime it's always an array. This
 * helper wraps the cast so call sites stay clean.
 */
async function gaql<T>(customer: AdsCustomer, query: string): Promise<T[]> {
  return (await customer.query(query)) as unknown as T[];
}

// ----- 1. Customer info ----------------------------------------------------
type CustomerInfoRow = {
  customer: {
    descriptive_name?: string;
    currency_code?: string;
    time_zone?: string;
    id?: string;
    manager?: boolean;
  };
};

async function pullCustomerInfo(customer: AdsCustomer) {
  const rows = await gaql<CustomerInfoRow>(customer, `
    SELECT
      customer.descriptive_name,
      customer.currency_code,
      customer.time_zone,
      customer.id,
      customer.manager
    FROM customer
    LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    descriptiveName: r.customer.descriptive_name ?? null,
    currencyCode: r.customer.currency_code ?? null,
    timeZone: r.customer.time_zone ?? null,
    isManager: r.customer.manager === true,
  };
}

// ----- 1b. Sub-account discovery (manager accounts only) ------------------
//
// `customer_client` returns every customer reachable from the queried
// account — managers, sub-managers, and leaf clients. We use this to
// surface ALL accounts under an MCC, not just the ones the OAuth user
// has been directly granted access to (those come back from
// `listAccessibleCustomers`).
type SubAccountRow = {
  customer_client: {
    id?: string;
    descriptive_name?: string;
    currency_code?: string;
    time_zone?: string;
    manager?: boolean;
    level?: number;
    status?: string;
    hidden?: boolean;
  };
};
type DiscoveredSubAccount = {
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  isManager: boolean;
};

async function pullSubAccounts(
  customer: AdsCustomer,
): Promise<DiscoveredSubAccount[]> {
  const rows = await gaql<SubAccountRow>(customer, `
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.currency_code,
      customer_client.time_zone,
      customer_client.manager,
      customer_client.level,
      customer_client.status,
      customer_client.hidden
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
  `);
  const out: DiscoveredSubAccount[] = [];
  for (const r of rows) {
    const c = r.customer_client;
    if (!c.id || c.hidden === true) continue;
    out.push({
      customerId: String(c.id),
      descriptiveName: c.descriptive_name ?? null,
      currencyCode: c.currency_code ?? null,
      timeZone: c.time_zone ?? null,
      isManager: c.manager === true,
    });
  }
  return out;
}

// ----- 2. Campaigns --------------------------------------------------------
type CampaignRow = {
  campaign: {
    id?: string;
    name?: string;
    status?: string | number;
    advertising_channel_type?: string | number;
    bidding_strategy_type?: string | number;
  };
  campaign_budget?: {
    amount_micros?: string;
  };
};
type ImportCampaign = {
  providerCampaignId: string;
  name: string;
  status: CampaignStatus;
  channelType: ChannelType;
  biddingStrategy: string | null;
  dailyBudgetMicros: bigint | null;
};

async function pullCampaigns(
  customer: AdsCustomer,
): Promise<{ campaigns: ImportCampaign[]; rawCount: number; skippedChannels: string[] }> {
  const rows = await gaql<CampaignRow>(customer, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `);
  const out: ImportCampaign[] = [];
  const skippedChannels: string[] = [];
  for (const r of rows) {
    const c = r.campaign;
    if (!c.id || !c.name) continue;
    const channel = mapChannelTypeOrFallback(
      c.advertising_channel_type,
      skippedChannels,
    );
    out.push({
      providerCampaignId: String(c.id),
      name: c.name,
      status: mapStatus(c.status),
      channelType: channel,
      biddingStrategy: mapBiddingStrategy(c.bidding_strategy_type),
      dailyBudgetMicros: r.campaign_budget?.amount_micros
        ? BigInt(r.campaign_budget.amount_micros)
        : null,
    });
  }
  return { campaigns: out, rawCount: rows.length, skippedChannels };
}

/**
 * Same as `mapChannelType` but never returns null — anything we don't
 * have a dedicated enum value for is imported as SEARCH (the safest
 * default) and the raw value is recorded so the user can see exactly
 * what Google returned.
 *
 * For v1 we treat it as a debug signal, not an error.
 */
function mapChannelTypeOrFallback(
  raw: string | number | undefined,
  skipped: string[],
): ChannelType {
  const mapped = mapChannelType(raw);
  if (mapped) return mapped;
  skipped.push(String(raw ?? "undefined"));
  return "SEARCH";
}

async function upsertCampaign(
  accountId: string,
  c: ImportCampaign,
): Promise<string> {
  const existing = await db.campaign.findFirst({
    where: { accountId, providerCampaignId: c.providerCampaignId },
    select: { id: true },
  });
  if (existing) {
    await db.campaign.update({
      where: { id: existing.id },
      data: {
        name: c.name,
        status: c.status,
        channelType: c.channelType,
        dailyBudgetMicros: c.dailyBudgetMicros,
        biddingStrategy: c.biddingStrategy,
        source: "imported",
      },
    });
    return existing.id;
  }
  const created = await db.campaign.create({
    data: {
      accountId,
      providerCampaignId: c.providerCampaignId,
      name: c.name,
      status: c.status,
      channelType: c.channelType,
      dailyBudgetMicros: c.dailyBudgetMicros,
      biddingStrategy: c.biddingStrategy,
      source: "imported",
      demoMode: false,
    },
  });
  return created.id;
}

// ----- 3. Ad groups --------------------------------------------------------
type AdGroupRow = {
  ad_group: {
    id?: string;
    name?: string;
    status?: string | number;
    campaign?: string; // resource name
    type?: string | number;
    cpc_bid_micros?: string;
  };
};
type ImportAdGroup = {
  providerCampaignId: string;
  providerAdGroupId: string;
  name: string;
  status: CampaignStatus;
  cpcBidMicros: bigint | null;
};

async function pullAdGroups(customer: AdsCustomer): Promise<ImportAdGroup[]> {
  const rows = await gaql<AdGroupRow>(customer, `
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.campaign,
      ad_group.type,
      ad_group.cpc_bid_micros
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
  `);
  const out: ImportAdGroup[] = [];
  for (const r of rows) {
    const g = r.ad_group;
    if (!g.id || !g.campaign) continue;
    out.push({
      providerCampaignId: extractId(g.campaign, "campaigns"),
      providerAdGroupId: String(g.id),
      name: g.name ?? "Imported ad group",
      status: mapStatus(g.status),
      cpcBidMicros: g.cpc_bid_micros ? BigInt(g.cpc_bid_micros) : null,
    });
  }
  return out;
}

async function upsertAdGroup(
  campaignId: string,
  g: ImportAdGroup,
): Promise<string> {
  const existing = await db.adGroup.findFirst({
    where: { campaignId, providerAdGroupId: g.providerAdGroupId },
    select: { id: true },
  });
  if (existing) {
    await db.adGroup.update({
      where: { id: existing.id },
      data: {
        name: g.name,
        status: g.status,
        cpcBidMicros: g.cpcBidMicros,
        source: "imported",
      },
    });
    return existing.id;
  }
  const created = await db.adGroup.create({
    data: {
      campaignId,
      providerAdGroupId: g.providerAdGroupId,
      name: g.name,
      status: g.status,
      cpcBidMicros: g.cpcBidMicros,
      headlines: [],
      descriptions: [],
      finalUrls: [],
      source: "imported",
    },
  });
  return created.id;
}

// ----- 4. RSAs -------------------------------------------------------------
type RsaRow = {
  ad_group_ad: {
    ad_group?: string;
    status?: string | number;
    ad?: {
      id?: string;
      type?: string | number;
      final_urls?: string[];
      responsive_search_ad?: {
        headlines?: Array<{ text?: string }>;
        descriptions?: Array<{ text?: string }>;
        path1?: string;
        path2?: string;
      };
    };
  };
};
type ImportRsa = {
  providerAdGroupId: string;
  providerAdId: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  path1: string | null;
  path2: string | null;
};

async function pullRsas(customer: AdsCustomer): Promise<ImportRsa[]> {
  const rows = await gaql<RsaRow>(customer, `
    SELECT
      ad_group_ad.ad_group,
      ad_group_ad.status,
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2
    FROM ad_group_ad
    WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      AND ad_group_ad.status != 'REMOVED'
  `);
  const out: ImportRsa[] = [];
  for (const r of rows) {
    const ad = r.ad_group_ad.ad;
    if (!ad?.id || !r.ad_group_ad.ad_group) continue;
    const rsa = ad.responsive_search_ad ?? {};
    out.push({
      providerAdGroupId: extractId(r.ad_group_ad.ad_group, "adGroups"),
      providerAdId: String(ad.id),
      headlines: (rsa.headlines ?? [])
        .map((h) => h.text ?? "")
        .filter(Boolean),
      descriptions: (rsa.descriptions ?? [])
        .map((d) => d.text ?? "")
        .filter(Boolean),
      finalUrls: ad.final_urls ?? [],
      path1: rsa.path1 ?? null,
      path2: rsa.path2 ?? null,
    });
  }
  return out;
}

// ----- 5. Keywords ---------------------------------------------------------
type KeywordRow = {
  ad_group_criterion: {
    criterion_id?: string;
    ad_group?: string;
    negative?: boolean;
    status?: string | number;
    keyword?: {
      text?: string;
      match_type?: string | number;
    };
  };
};
type ImportKeyword = {
  providerAdGroupId: string;
  providerCriterionId: string;
  text: string;
  matchType: KeywordMatchType;
  isNegative: boolean;
  status: CampaignStatus;
};

async function pullKeywords(customer: AdsCustomer): Promise<ImportKeyword[]> {
  const rows = await gaql<KeywordRow>(customer, `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.ad_group,
      ad_group_criterion.negative,
      ad_group_criterion.status,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
  `);
  const out: ImportKeyword[] = [];
  for (const r of rows) {
    const c = r.ad_group_criterion;
    if (!c.criterion_id || !c.ad_group || !c.keyword?.text) continue;
    out.push({
      providerAdGroupId: extractId(c.ad_group, "adGroups"),
      providerCriterionId: String(c.criterion_id),
      text: c.keyword.text,
      matchType: mapMatchType(c.keyword.match_type),
      isNegative: c.negative === true,
      status: mapStatus(c.status),
    });
  }
  return out;
}

async function upsertKeyword(adGroupId: string, k: ImportKeyword) {
  const existing = await db.keyword.findFirst({
    where: { adGroupId, providerCriterionId: k.providerCriterionId },
    select: { id: true },
  });
  if (existing) {
    await db.keyword.update({
      where: { id: existing.id },
      data: {
        text: k.text,
        matchType: k.matchType,
        isNegative: k.isNegative,
        status: k.status,
        source: "imported",
      },
    });
    return;
  }
  await db.keyword.create({
    data: {
      adGroupId,
      providerCriterionId: k.providerCriterionId,
      text: k.text,
      matchType: k.matchType,
      isNegative: k.isNegative,
      status: k.status,
      source: "imported",
    },
  });
}

// ----- 6. Asset groups -----------------------------------------------------
type AssetGroupRow = {
  asset_group: {
    id?: string;
    name?: string;
    campaign?: string;
    status?: string | number;
    final_urls?: string[];
  };
};
type ImportAssetGroup = {
  providerCampaignId: string;
  providerAssetGroupId: string;
  name: string;
  status: CampaignStatus;
  finalUrl: string | null;
};

async function pullAssetGroups(customer: AdsCustomer): Promise<ImportAssetGroup[]> {
  const rows = await gaql<AssetGroupRow>(customer, `
    SELECT
      asset_group.id,
      asset_group.name,
      asset_group.campaign,
      asset_group.status,
      asset_group.final_urls
    FROM asset_group
    WHERE asset_group.status != 'REMOVED'
  `);
  const out: ImportAssetGroup[] = [];
  for (const r of rows) {
    const g = r.asset_group;
    if (!g.id || !g.campaign) continue;
    out.push({
      providerCampaignId: extractId(g.campaign, "campaigns"),
      providerAssetGroupId: String(g.id),
      name: g.name ?? "Imported asset group",
      status: mapStatus(g.status),
      finalUrl: g.final_urls?.[0] ?? null,
    });
  }
  return out;
}

async function upsertAssetGroup(
  campaignId: string,
  g: ImportAssetGroup,
): Promise<string> {
  const existing = await db.assetGroup.findFirst({
    where: { campaignId, providerAssetGroupId: g.providerAssetGroupId },
    select: { id: true },
  });
  if (existing) {
    await db.assetGroup.update({
      where: { id: existing.id },
      data: {
        name: g.name,
        status: g.status,
        finalUrl: g.finalUrl,
        source: "imported",
      },
    });
    return existing.id;
  }
  const created = await db.assetGroup.create({
    data: {
      campaignId,
      providerAssetGroupId: g.providerAssetGroupId,
      name: g.name,
      status: g.status,
      finalUrl: g.finalUrl,
      headlines: [],
      longHeadlines: [],
      descriptions: [],
      source: "imported",
    },
  });
  return created.id;
}

// ----- 7. Asset-group text assets -----------------------------------------
//
// PMAX text assets are stored as `Asset` rows in Google's model, linked
// to asset groups via `asset_group_asset` with a `field_type` enum:
//   HEADLINE / LONG_HEADLINE / DESCRIPTION / BUSINESS_NAME
//
// We aggregate text content per asset group, then fold it into the
// AssetGroup row (headlines / longHeadlines / descriptions / businessName).
type AssetGroupAssetRow = {
  asset_group_asset: {
    asset_group?: string;
    field_type?: string;
  };
  asset?: {
    type?: string;
    text_asset?: {
      text?: string;
    };
  };
};
type TextBucket = {
  headlines: string[];
  longHeadlines: string[];
  descriptions: string[];
  businessName: string | null;
};

async function pullAssetGroupTextAssets(
  customer: AdsCustomer,
): Promise<Map<string, TextBucket>> {
  const rows = await gaql<AssetGroupAssetRow>(customer, `
    SELECT
      asset_group_asset.asset_group,
      asset_group_asset.field_type,
      asset.type,
      asset.text_asset.text
    FROM asset_group_asset
    WHERE asset.type = 'TEXT'
  `);
  const map = new Map<string, TextBucket>();
  for (const r of rows) {
    const groupRef = r.asset_group_asset.asset_group;
    const text = r.asset?.text_asset?.text;
    const field = r.asset_group_asset.field_type;
    if (!groupRef || !text || !field) continue;
    const providerAssetGroupId = extractId(groupRef, "assetGroups");
    const bucket =
      map.get(providerAssetGroupId) ??
      ({
        headlines: [],
        longHeadlines: [],
        descriptions: [],
        businessName: null,
      } satisfies TextBucket);
    if (field === "HEADLINE") bucket.headlines.push(text);
    else if (field === "LONG_HEADLINE") bucket.longHeadlines.push(text);
    else if (field === "DESCRIPTION") bucket.descriptions.push(text);
    else if (field === "BUSINESS_NAME" && !bucket.businessName)
      bucket.businessName = text;
    map.set(providerAssetGroupId, bucket);
  }
  return map;
}

// ----- 8. Conversion actions -----------------------------------------------
type ConversionActionRow = {
  conversion_action: {
    id?: string;
    name?: string;
    status?: string | number;
    category?: string | number;
    counting_type?: string | number;
    click_through_lookback_window_days?: number;
    primary_for_goal?: boolean;
    value_settings?: {
      default_value?: number;
      always_use_default_value?: boolean;
    };
  };
};
type ImportConversionAction = {
  providerConversionId: string;
  name: string;
  status: CampaignStatus;
  category: ConversionCategory;
  countingType: string | null;
  clickThroughLookbackDays: number | null;
  isPrimary: boolean;
  valueMicros: bigint | null;
};

async function pullConversionActions(
  customer: AdsCustomer,
): Promise<ImportConversionAction[]> {
  const rows = await gaql<ConversionActionRow>(customer, `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.category,
      conversion_action.counting_type,
      conversion_action.click_through_lookback_window_days,
      conversion_action.primary_for_goal,
      conversion_action.value_settings.default_value,
      conversion_action.value_settings.always_use_default_value
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
  `);
  const out: ImportConversionAction[] = [];
  for (const r of rows) {
    const c = r.conversion_action;
    if (!c.id || !c.name) continue;
    out.push({
      providerConversionId: String(c.id),
      name: c.name,
      status: mapStatus(c.status),
      category: mapConversionCategory(c.category),
      countingType:
        typeof c.counting_type === "number"
          ? String(c.counting_type)
          : c.counting_type ?? null,
      clickThroughLookbackDays:
        c.click_through_lookback_window_days ?? null,
      isPrimary: c.primary_for_goal === true,
      valueMicros: c.value_settings?.always_use_default_value
        ? BigInt(Math.round((c.value_settings.default_value ?? 0) * 1_000_000))
        : null,
    });
  }
  return out;
}

async function upsertConversionAction(
  accountId: string,
  a: ImportConversionAction,
) {
  const existing = await db.conversionAction.findFirst({
    where: { accountId, providerConversionId: a.providerConversionId },
    select: { id: true },
  });
  if (existing) {
    await db.conversionAction.update({
      where: { id: existing.id },
      data: {
        name: a.name,
        status: a.status,
        category: a.category,
        countingType: a.countingType,
        clickThroughLookbackDays: a.clickThroughLookbackDays,
        isPrimary: a.isPrimary,
        valueMicros: a.valueMicros,
        source: "imported",
      },
    });
    return;
  }
  await db.conversionAction.create({
    data: {
      accountId,
      providerConversionId: a.providerConversionId,
      name: a.name,
      status: a.status,
      category: a.category,
      countingType: a.countingType,
      clickThroughLookbackDays: a.clickThroughLookbackDays,
      isPrimary: a.isPrimary,
      valueMicros: a.valueMicros,
      source: "imported",
    },
  });
}

// ===========================================================================
// Helpers
// ===========================================================================

function extractId(resourceName: string, collection: string): string {
  // "customers/12345/campaigns/67890" → "67890"
  const re = new RegExp(`${collection}/([0-9]+)$`);
  const m = resourceName.match(re);
  return m?.[1] ?? resourceName;
}

// Google Ads SDK may return enum fields as either the string name or the
// protobuf integer value depending on the runtime config. We accept
// both and normalize via these tables. Integer values come from the
// Google Ads proto definitions (see
// https://developers.google.com/google-ads/api/reference/rpc/v17/...).

const STATUS_INT: Record<number, CampaignStatus> = {
  2: "ENABLED",
  3: "PAUSED",
  4: "REMOVED",
};

function mapStatus(raw: string | number | undefined): CampaignStatus {
  if (typeof raw === "number") return STATUS_INT[raw] ?? "PAUSED";
  switch (raw) {
    case "ENABLED":
      return "ENABLED";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "REMOVED";
    default:
      return "PAUSED";
  }
}

const CHANNEL_INT: Record<number, ChannelType> = {
  2: "SEARCH",
  3: "DISPLAY",
  6: "VIDEO",
  10: "PMAX",
  12: "DISCOVERY",
  14: "DISCOVERY", // DEMAND_GEN renamed in v15+
};

function mapChannelType(
  raw: string | number | undefined,
): ChannelType | null {
  if (typeof raw === "number") return CHANNEL_INT[raw] ?? null;
  switch (raw) {
    case "SEARCH":
      return "SEARCH";
    case "DISPLAY":
      return "DISPLAY";
    case "VIDEO":
      return "VIDEO";
    case "PERFORMANCE_MAX":
      return "PMAX";
    case "DISCOVERY":
    case "DEMAND_GEN":
      return "DISCOVERY";
    default:
      return null; // skip Shopping, Hotel, Local, Smart, etc.
  }
}

const MATCH_TYPE_INT: Record<number, KeywordMatchType> = {
  2: "EXACT",
  3: "PHRASE",
  4: "BROAD",
};

function mapMatchType(raw: string | number | undefined): KeywordMatchType {
  if (typeof raw === "number") return MATCH_TYPE_INT[raw] ?? "BROAD";
  switch (raw) {
    case "EXACT":
      return "EXACT";
    case "PHRASE":
      return "PHRASE";
    case "BROAD":
      return "BROAD";
    default:
      return "BROAD";
  }
}

const BIDDING_STRATEGY_INT: Record<number, string> = {
  3: "ENHANCED_CPC",
  5: "MANUAL_CPA",
  6: "MANUAL_CPC",
  7: "MANUAL_CPM",
  8: "MANUAL_CPV",
  9: "MAXIMIZE_CONVERSIONS",
  10: "MAXIMIZE_CONVERSION_VALUE",
  12: "PERCENT_CPC",
  13: "TARGET_CPA",
  14: "TARGET_CPM",
  15: "TARGET_IMPRESSION_SHARE",
  16: "TARGET_OUTRANK_SHARE",
  17: "TARGET_ROAS",
  18: "TARGET_SPEND",
};

function mapBiddingStrategy(raw: string | number | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw === "number")
    return BIDDING_STRATEGY_INT[raw] ?? `UNKNOWN_${raw}`;
  return raw;
}

const CONVERSION_CATEGORY_INT: Record<number, ConversionCategory> = {
  2: "PAGE_VIEW",
  3: "PURCHASE",
  4: "SIGNUP",
  5: "LEAD",
  6: "DOWNLOAD",
  7: "STORE_VISIT",
  8: "STORE_SALE",
  9: "PHONE_CALL_LEAD",
  10: "IMPORTED_LEAD",
  11: "SUBMIT_LEAD_FORM",
  12: "BOOK_APPOINTMENT",
  13: "REQUEST_QUOTE",
  14: "ADD_TO_CART",
  15: "BEGIN_CHECKOUT",
  16: "SUBSCRIBE_PAID",
  17: "CONTACT",
  18: "GET_DIRECTIONS",
};

function mapConversionCategory(
  raw: string | number | undefined,
): ConversionCategory {
  if (typeof raw === "number")
    return CONVERSION_CATEGORY_INT[raw] ?? "OTHER";
  switch (raw) {
    case "PAGE_VIEW":
    case "PURCHASE":
    case "SIGNUP":
    case "LEAD":
    case "DOWNLOAD":
    case "STORE_VISIT":
    case "STORE_SALE":
    case "PHONE_CALL_LEAD":
    case "IMPORTED_LEAD":
    case "SUBMIT_LEAD_FORM":
    case "BOOK_APPOINTMENT":
    case "REQUEST_QUOTE":
    case "ADD_TO_CART":
    case "BEGIN_CHECKOUT":
    case "SUBSCRIBE_PAID":
    case "CONTACT":
    case "GET_DIRECTIONS":
      return raw;
    default:
      return "OTHER";
  }
}

function errMsg(e: unknown): string {
  // Google Ads SDK throws structured failures — see the matching helper
  // in `sync.ts` for the full shape rationale.
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    const errors = obj.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors
        .map((er) => {
          if (typeof er !== "object" || er === null) return String(er);
          const m = (er as { message?: unknown }).message;
          if (typeof m === "string" && m) return m;
          try {
            return JSON.stringify(er);
          } catch {
            return "[unserializable error]";
          }
        })
        .join("; ");
    }
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable error object]";
    }
  }
  return String(e);
}
