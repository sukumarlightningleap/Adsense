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

import { loadCredentials, type GoogleAdsCredentials } from "./auth";

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
