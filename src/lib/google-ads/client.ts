/**
 * Google Ads API client factory.
 *
 * The Opteo `google-ads-api` Node wrapper is a thin client over gRPC.
 * We keep one `GoogleAdsApi` instance per process (cheap) and mint a
 * `Customer` per customer-id (also cheap — just holds the refresh
 * token + customer ID).
 *
 * Heavy gRPC bootstrap happens lazily on first call.
 */
import { GoogleAdsApi, type Customer } from "google-ads-api";
import type { AdsAccount } from "@prisma/client";

import {
  loadCredentials,
  loadCredentialsForAccount,
  type GoogleAdsCredentials,
} from "./auth";

let cachedClient: GoogleAdsApi | null = null;
let cachedCredsKey: string | null = null;

function credsKey(c: GoogleAdsCredentials): string {
  // If the active profile flips at runtime (rare — would be a dev/test
  // switch), bust the cache so we don't use stale credentials.
  return `${c.profile}:${c.clientId}:${c.developerToken}`;
}

export function buildClient(): {
  client: GoogleAdsApi;
  creds: GoogleAdsCredentials;
} {
  const creds = loadCredentials();
  const key = credsKey(creds);
  if (cachedClient && cachedCredsKey === key) {
    return { client: cachedClient, creds };
  }
  cachedClient = new GoogleAdsApi({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    developer_token: creds.developerToken,
  });
  cachedCredsKey = key;
  return { client: cachedClient, creds };
}

/**
 * Mint a Customer scoped to a specific customer-id. If the caller passes
 * a `loginCustomerId` (per-account override), it wins over the env one
 * — supports launching into sub-accounts of different MCCs.
 */
export function buildCustomer(args: {
  customerId: string;
  loginCustomerId?: string;
}): Customer {
  const { client, creds } = buildClient();
  return client.Customer({
    customer_id: args.customerId.replace(/-/g, "").trim(),
    refresh_token: creds.refreshToken,
    login_customer_id:
      args.loginCustomerId?.replace(/-/g, "").trim() ||
      creds.loginCustomerId,
  });
}

/**
 * Mint a Customer using the credentials stored on an AdsAccount row.
 * Falls back to env-based credentials when the row has no OAuth token
 * (legacy accounts), so the launcher can keep working pre-Phase-8a.
 *
 * Used by the adoption importer + daily sync cron + write-back actions.
 */
export function buildCustomerForAccount(
  account: Pick<
    AdsAccount,
    | "customerId"
    | "loginCustomerId"
    | "mccCustomerId"
    | "oauthRefreshToken"
  >,
): Customer {
  const creds = loadCredentialsForAccount(account);
  // Mint a fresh client only if creds differ from cache (rare — only when
  // env profile flips). For per-account creds the developer_token +
  // client_id are stable across all customer accounts; the refresh_token
  // is what varies and is passed to .Customer() not the constructor.
  const { client } = buildClient();
  return client.Customer({
    customer_id: account.customerId.replace(/-/g, "").trim(),
    refresh_token: creds.refreshToken,
    login_customer_id: creds.loginCustomerId,
  });
}
