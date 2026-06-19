/**
 * Google Ads credential resolution — two sources:
 *
 *   1. PROFILE-based (legacy / dev):
 *      `.env`-driven, single shared refresh token. `GOOGLE_ADS_PROFILE`
 *      switches between 'test' and 'prod'. Used by the launcher pre-OAuth.
 *
 *   2. PER-ACCOUNT (Phase 8a / production):
 *      Each `AdsAccount` row carries its own encrypted refresh token,
 *      captured when the customer OAuth'd. `loadCredentialsForAccount()`
 *      decrypts it and packages it the same shape as the profile-based
 *      flow, so downstream code (client.ts, importer.ts) works identically.
 *
 * Falls back to profile credentials when the account has no stored token
 * (e.g. legacy accounts pre-Phase-8a).
 */
import type { AdsAccount } from "@prisma/client";

import { decryptToken } from "@/lib/crypto/token-vault";

export type Profile = "test" | "prod";

export type GoogleAdsCredentials = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** MCC ID — required if you're operating sub-accounts under an MCC. */
  loginCustomerId: string | undefined;
  profile: Profile;
};

/**
 * Which profile is currently active. Defaults to 'test' — safer to
 * accidentally push nothing to a real account than to ship a bug that
 * spends prod money.
 */
export function activeProfile(): Profile {
  const raw = process.env.GOOGLE_ADS_PROFILE?.toLowerCase().trim();
  return raw === "prod" ? "prod" : "test";
}

export function isProdProfile(): boolean {
  return activeProfile() === "prod";
}

/**
 * Load credentials for the active profile. Strips dashes from the MCC
 * ID and returns undefined if it's blank.
 */
export function loadCredentials(): GoogleAdsCredentials {
  const profile = activeProfile();
  const prefix = profile === "test" ? "GOOGLE_ADS_TEST_" : "GOOGLE_ADS_";

  const developerToken = env(`${prefix}DEVELOPER_TOKEN`);
  const clientId = env(`${prefix}CLIENT_ID`);
  const clientSecret = env(`${prefix}CLIENT_SECRET`);
  const refreshToken = env(`${prefix}REFRESH_TOKEN`);
  const loginCustomerIdRaw = env(`${prefix}LOGIN_CUSTOMER_ID`, { optional: true });

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    loginCustomerId: loginCustomerIdRaw
      ? loginCustomerIdRaw.replace(/-/g, "").trim() || undefined
      : undefined,
    profile,
  };
}

function env(
  name: string,
  opts: { optional?: boolean } = {},
): string {
  const v = process.env[name]?.trim();
  if (!v) {
    if (opts.optional) return "";
    throw new Error(
      `Google Ads env var ${name} is not set. Active profile: ${activeProfile()}.`,
    );
  }
  // Strip surrounding quotes if someone wrapped the .env value.
  return v.replace(/^['"]|['"]$/g, "");
}

/**
 * OAuth client config (no refresh token) for the active profile.
 *
 * Use this when you need to *issue* an OAuth flow (start a consent
 * redirect, exchange an authorization code, list accessible customers).
 * Always reads from the active profile's prefix — `GOOGLE_ADS_TEST_*`
 * for the test profile, `GOOGLE_ADS_*` for prod — so dev work happens
 * under the test OAuth client and never accidentally hits the prod
 * client during local testing.
 */
export function loadOAuthClientConfig(): {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  loginCustomerId: string | undefined;
  profile: Profile;
} {
  const profile = activeProfile();
  const prefix = profile === "test" ? "GOOGLE_ADS_TEST_" : "GOOGLE_ADS_";
  const loginRaw = env(`${prefix}LOGIN_CUSTOMER_ID`, { optional: true });
  return {
    clientId: env(`${prefix}CLIENT_ID`),
    clientSecret: env(`${prefix}CLIENT_SECRET`),
    developerToken: env(`${prefix}DEVELOPER_TOKEN`),
    loginCustomerId: loginRaw
      ? loginRaw.replace(/-/g, "").trim() || undefined
      : undefined,
    profile,
  };
}

/**
 * Load credentials scoped to a specific AdsAccount row.
 *
 *   - If the account has its own encrypted `oauthRefreshToken` (Phase 8a
 *     onwards), decrypt and use it.
 *   - Otherwise fall back to the profile-level env credentials (legacy /
 *     dev accounts).
 *
 * The `developerToken` always comes from env — that's the OAuth client's
 * developer token, identical across all customer accounts under one
 * Google Cloud project.
 */
export function loadCredentialsForAccount(
  account: Pick<
    AdsAccount,
    "oauthRefreshToken" | "loginCustomerId" | "mccCustomerId"
  >,
): GoogleAdsCredentials {
  if (!account.oauthRefreshToken) {
    // Legacy path — use env refresh token. The `loginCustomerId` from
    // the DB row still wins if set; otherwise fall back to env.
    const fallback = loadCredentials();
    return {
      ...fallback,
      loginCustomerId:
        account.loginCustomerId?.replace(/-/g, "").trim() ||
        account.mccCustomerId?.replace(/-/g, "").trim() ||
        fallback.loginCustomerId,
    };
  }

  // Phase 8a path — per-account encrypted token.
  const profile = activeProfile();
  const prefix = profile === "test" ? "GOOGLE_ADS_TEST_" : "GOOGLE_ADS_";

  // Resolve login_customer_id for the gRPC header in this order:
  //   1. The account's own loginCustomerId (set by an explicit override)
  //   2. The MCC the OAuth grant happened under (mccCustomerId)
  //   3. Env LOGIN_CUSTOMER_ID for the active profile — handles the
  //      common case where the user's whole tree of test sub-accounts
  //      sits under one known MCC.
  // Sub-account queries against Google Ads ALWAYS require an MCC
  // header; without one the API rejects every GAQL call with
  // USER_PERMISSION_DENIED.
  const envLoginRaw = env(`${prefix}LOGIN_CUSTOMER_ID`, { optional: true });
  const loginCustomerId =
    account.loginCustomerId?.replace(/-/g, "").trim() ||
    account.mccCustomerId?.replace(/-/g, "").trim() ||
    (envLoginRaw ? envLoginRaw.replace(/-/g, "").trim() : "") ||
    undefined;

  return {
    developerToken: env(`${prefix}DEVELOPER_TOKEN`),
    clientId: env(`${prefix}CLIENT_ID`),
    clientSecret: env(`${prefix}CLIENT_SECRET`),
    refreshToken: decryptToken(account.oauthRefreshToken),
    loginCustomerId,
    profile,
  };
}
