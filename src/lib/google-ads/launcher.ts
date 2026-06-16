/**
 * Launch orchestrator — port of
 * adwords-benchmarks/src/launcher/providers/google_ads/launcher.py.
 *
 * The orchestrator is the ONLY entry point for pushing a campaign to
 * Google Ads. It runs every safety check before touching the SDK:
 *
 *   1. Campaign exists, belongs to the caller, is PAUSED in our DB
 *   2. NOT a demo campaign (demo never touches real Google)
 *   3. Channel is SEARCH (PMAX / DISPLAY land in later phases)
 *   4. Daily budget ≤ LAUNCHER_MAX_DAILY_USD (env cap)
 *   5. payloadJson exists (built by the wizard at save time)
 *   6. AdsAccount has a customer_id and OAuth creds are configured
 *
 * Then it calls the adapter, persists the provider campaign ID + resource
 * name on our Campaign row, and audit-logs the launch with the active
 * credential profile (test/prod) for traceability.
 */
import type {
  LaunchPayload,
  SearchLaunchPayload,
} from "@/lib/wizard/payload-builder";

import { activeProfile } from "./auth";
import { buildCustomer } from "./client";
import { launchSearchCampaign, type LaunchResult } from "./adapter";

export type LauncherError = {
  ok: false;
  code:
    | "NOT_FOUND"
    | "NOT_DRAFT"
    | "DEMO_BLOCKED"
    | "CHANNEL_UNSUPPORTED"
    | "BUDGET_OVER_CAP"
    | "PAYLOAD_MISSING"
    | "CREDENTIALS_MISSING"
    | "SDK_FAILED";
  message: string;
};

export type LauncherSuccess = {
  ok: true;
  profile: "test" | "prod";
  result: LaunchResult;
};

export type LauncherOutcome = LauncherError | LauncherSuccess;

export function launcherMaxDailyUsd(): number {
  const raw = process.env.LAUNCHER_MAX_DAILY_USD?.trim();
  if (!raw) return 10; // default cap
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/**
 * Preflight: run every safety check WITHOUT touching the SDK. Returns
 * either an error or the fully-validated launch context.
 */
export type LaunchContext = {
  campaignId: string;
  /** Day 4 narrows this to SearchLaunchPayload — only SEARCH ships. */
  payload: SearchLaunchPayload;
  customerId: string;
  loginCustomerId: string | undefined;
};

export function preflight(args: {
  campaign: {
    id: string;
    status: string;
    channelType: string;
    demoMode: boolean;
    dailyBudgetMicros: bigint | null;
    payloadJson: unknown;
  };
  account: {
    customerId: string;
    loginCustomerId: string | null;
    demoMode: boolean;
  };
}): { ok: false; error: LauncherError } | { ok: true; ctx: LaunchContext } {
  const { campaign, account } = args;

  if (campaign.demoMode || account.demoMode) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "DEMO_BLOCKED",
        message: "Demo campaigns and accounts can never be launched.",
      },
    };
  }
  if (campaign.status !== "PAUSED") {
    return {
      ok: false,
      error: {
        ok: false,
        code: "NOT_DRAFT",
        message: `Campaign is ${campaign.status}; only PAUSED drafts can be launched.`,
      },
    };
  }
  if (campaign.channelType !== "SEARCH") {
    return {
      ok: false,
      error: {
        ok: false,
        code: "CHANNEL_UNSUPPORTED",
        message: `Channel ${campaign.channelType} not supported yet. Only SEARCH ships in Phase 4.`,
      },
    };
  }

  const cap = launcherMaxDailyUsd();
  const dailyUsd = Number(campaign.dailyBudgetMicros ?? 0n) / 1_000_000;
  if (dailyUsd > cap) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "BUDGET_OVER_CAP",
        message: `Daily budget $${dailyUsd.toFixed(2)} exceeds the launcher cap ($${cap}). Raise LAUNCHER_MAX_DAILY_USD or lower the campaign budget.`,
      },
    };
  }

  if (!campaign.payloadJson || typeof campaign.payloadJson !== "object") {
    return {
      ok: false,
      error: {
        ok: false,
        code: "PAYLOAD_MISSING",
        message:
          "Campaign has no structured payload — re-create from the wizard. Old drafts from before Phase 4 don't have payload_json yet.",
      },
    };
  }

  if (!account.customerId) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "CREDENTIALS_MISSING",
        message: "Account has no customer ID.",
      },
    };
  }

  // Confirm env-level creds are present BEFORE making any SDK call so the
  // operator sees a clean error, not a gRPC explosion.
  try {
    void buildCustomer({
      customerId: account.customerId,
      loginCustomerId: account.loginCustomerId ?? undefined,
    });
  } catch (e) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "CREDENTIALS_MISSING",
        message:
          e instanceof Error
            ? e.message
            : "Google Ads credentials are not configured in .env.",
      },
    };
  }

  // SEARCH channel was already gated above — narrow accordingly.
  const payload = campaign.payloadJson as unknown as LaunchPayload;
  if (payload.channel !== "SEARCH") {
    return {
      ok: false,
      error: {
        ok: false,
        code: "CHANNEL_UNSUPPORTED",
        message: `Payload channel ${payload.channel} not supported by Phase 4 launcher.`,
      },
    };
  }

  return {
    ok: true,
    ctx: {
      campaignId: campaign.id,
      payload,
      customerId: account.customerId,
      loginCustomerId: account.loginCustomerId ?? undefined,
    },
  };
}

/**
 * Hit the SDK. Wraps any thrown error into a typed failure so the caller
 * always gets a structured outcome.
 */
export async function executeLaunch(
  ctx: LaunchContext,
): Promise<LauncherOutcome> {
  try {
    const customer = buildCustomer({
      customerId: ctx.customerId,
      loginCustomerId: ctx.loginCustomerId,
    });
    const result = await launchSearchCampaign({
      customer,
      payload: ctx.payload,
    });
    return { ok: true, profile: activeProfile(), result };
  } catch (e) {
    return {
      ok: false,
      code: "SDK_FAILED",
      message: extractSdkError(e),
    };
  }
}

/**
 * Google Ads errors from the Opteo SDK come back as a structured
 * `GoogleAdsFailure` with field-level reasons. Pull the most useful
 * piece for surface display; full payload is in the audit log.
 */
function extractSdkError(e: unknown): string {
  if (e instanceof Error) {
    // Opteo's `GoogleAdsFailure` exposes `.errors[]` with `.message`.
    const errs = (e as unknown as { errors?: Array<{ message?: string }> })
      .errors;
    if (Array.isArray(errs) && errs.length > 0) {
      return errs
        .map((er) => er.message)
        .filter(Boolean)
        .join("; ");
    }
    return e.message;
  }
  return String(e);
}
