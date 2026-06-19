/**
 * Write-back helpers for bidirectional campaign control.
 *
 *   - `setCampaignStatus`   — push ENABLED / PAUSED / REMOVED to Google,
 *                             then update our DB row to match.
 *   - `refreshCampaignFromGoogle` — pull this one campaign's current
 *                             config from Google and overwrite our row.
 *                             Used by the "Refresh from Google" button so
 *                             the user can sync external changes without
 *                             waiting for the daily cron or re-running
 *                             the full account import.
 *
 * Audit-logs every write — the AuditLog is our paper trail for "who
 * paused what when" disputes with customers.
 */
import type { CampaignStatus, AdsAccount } from "@prisma/client";

import { db } from "@/lib/db";

import { buildCustomerForAccount } from "./client";

type AdsCustomer = ReturnType<typeof buildCustomerForAccount>;
async function gaql<T>(customer: AdsCustomer, query: string): Promise<T[]> {
  return (await customer.query(query)) as unknown as T[];
}

export type SetStatusResult =
  | { ok: true; previousStatus: CampaignStatus; newStatus: CampaignStatus }
  | { ok: false; error: string };

/**
 * Mutate a campaign's status in Google Ads + mirror in our DB.
 */
export async function setCampaignStatus(opts: {
  campaignId: string;        // our DB id
  userId: string;
  newStatus: "ENABLED" | "PAUSED" | "REMOVED";
}): Promise<SetStatusResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: opts.campaignId },
    include: { account: true },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.account.userId !== opts.userId) {
    return { ok: false, error: "Not your campaign." };
  }
  if (!campaign.providerCampaignId) {
    return {
      ok: false,
      error: "Campaign has no provider ID — never launched to Google.",
    };
  }

  const customer = buildCustomerForAccount(campaign.account);
  const customerIdNum = campaign.account.customerId.replace(/-/g, "");
  const resourceName = `customers/${customerIdNum}/campaigns/${campaign.providerCampaignId}`;

  try {
    // Opteo SDK pattern — `customer.campaigns.update(...)` issues a
    // CampaignService.mutate with operation_type=update behind the scenes.
    // The status string maps cleanly to Google's CampaignStatus enum.
    await customer.campaigns.update([
      {
        resource_name: resourceName,
        status: opts.newStatus,
      },
    ]);
  } catch (e) {
    return {
      ok: false,
      error: extractGoogleError(e),
    };
  }

  // Mirror in our DB.
  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: opts.newStatus },
  });

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "campaign.status_change",
      targetKind: "campaign",
      targetId: campaign.id,
      payload: {
        previousStatus: campaign.status,
        newStatus: opts.newStatus,
        providerCampaignId: campaign.providerCampaignId,
      },
    },
  });

  return {
    ok: true,
    previousStatus: campaign.status,
    newStatus: opts.newStatus,
  };
}

export type RefreshResult =
  | { ok: true; updated: { name?: string; status?: CampaignStatus } }
  | { ok: false; error: string };

/**
 * Pull this one campaign's current config from Google and update our DB
 * row. Cheap — single GAQL row. Used when the customer says "I just
 * paused this in Google's UI, why isn't it updated here?"
 */
export async function refreshCampaignFromGoogle(opts: {
  campaignId: string;
  userId: string;
}): Promise<RefreshResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: opts.campaignId },
    include: { account: true },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.account.userId !== opts.userId) {
    return { ok: false, error: "Not your campaign." };
  }
  if (!campaign.providerCampaignId) {
    return { ok: false, error: "Campaign has no provider ID." };
  }

  type Row = {
    campaign: {
      id?: string;
      name?: string;
      status?: string | number;
    };
  };

  const customer = buildCustomerForAccount(campaign.account);
  let rows: Row[];
  try {
    rows = await gaql<Row>(
      customer,
      `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status
      FROM campaign
      WHERE campaign.id = ${campaign.providerCampaignId}
      LIMIT 1
      `,
    );
  } catch (e) {
    return { ok: false, error: extractGoogleError(e) };
  }
  const r = rows[0];
  if (!r) {
    return {
      ok: false,
      error: "Google returned no row for this campaign id. Was it removed?",
    };
  }

  const newStatus = mapStatus(r.campaign.status);
  const newName = r.campaign.name ?? campaign.name;

  await db.campaign.update({
    where: { id: campaign.id },
    data: {
      name: newName,
      status: newStatus,
    },
  });

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "campaign.refresh",
      targetKind: "campaign",
      targetId: campaign.id,
      payload: {
        previousName: campaign.name,
        newName,
        previousStatus: campaign.status,
        newStatus,
      },
    },
  });

  return { ok: true, updated: { name: newName, status: newStatus } };
}

// ===========================================================================
// Helpers
// ===========================================================================

function mapStatus(raw: string | number | undefined): CampaignStatus {
  if (typeof raw === "number") {
    if (raw === 2) return "ENABLED";
    if (raw === 3) return "PAUSED";
    if (raw === 4) return "REMOVED";
    return "PAUSED";
  }
  if (raw === "ENABLED") return "ENABLED";
  if (raw === "PAUSED") return "PAUSED";
  if (raw === "REMOVED") return "REMOVED";
  return "PAUSED";
}

function extractGoogleError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      return obj.errors
        .map((er) => {
          if (typeof er === "object" && er !== null) {
            const m = (er as { message?: unknown }).message;
            if (typeof m === "string") return m;
          }
          return String(er);
        })
        .join("; ");
    }
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable error]";
    }
  }
  return String(e);
}

// Acknowledge the parameter exists so the import isn't pruned by
// tree-shaking — referenced internally above. The type re-export is a
// helpful surface for callers.
export type { AdsAccount };
