/**
 * Google OAuth 2.0 flow for connecting a customer's Google Ads account.
 *
 *   - `buildAuthorizationUrl(state)` → consent screen URL
 *   - `exchangeCodeForTokens(code)`  → refresh_token + access_token
 *   - `listAccessibleCustomers(rt)`  → array of customer IDs visible to that token
 *   - `signState() / verifyState()`  → HMAC-signed state to defeat CSRF
 *
 * Why hand-roll instead of NextAuth's Google provider:
 *   1. NextAuth's Google provider is for *sign-in*, not for capturing a
 *      long-lived refresh token tied to a specific external API.
 *   2. We need precise control over `access_type=offline` + `prompt=consent`
 *      so we always get a fresh refresh token, even on re-auth.
 *   3. The scope is Google Ads (`adwords`), not the standard OIDC profile.
 *
 * Reuses `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` from .env —
 * same OAuth client that issues the dev's hard-coded refresh token. The
 * client's Authorized Redirect URIs in GCP Console MUST include this app's
 * callback URL (e.g. `http://localhost:3001/api/google-ads/oauth/callback`).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { GoogleAdsApi } from "google-ads-api";

import { loadOAuthClientConfig } from "./auth";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";

function appUrl(): string {
  const v = process.env.NEXTAUTH_URL?.trim();
  if (!v) throw new Error("NEXTAUTH_URL is not set — required to build OAuth callback URL.");
  return v.replace(/\/$/, "");
}

export function redirectUri(): string {
  return `${appUrl()}/api/google-ads/oauth/callback`;
}

export function buildAuthorizationUrl(state: string): string {
  const { clientId } = loadOAuthClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: ADWORDS_SCOPE,
    // `offline` is required to get a refresh token back. Without it Google
    // returns only a short-lived access token — useless for cron sync.
    access_type: "offline",
    // Force consent so we always get a refresh_token, even if the user
    // has authorized this client before.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type TokenExchangeResult = {
  refreshToken: string;
  accessToken: string;
  scope: string;
  expiresInSec: number;
  tokenType: string;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenExchangeResult> {
  const { clientId, clientSecret } = loadOAuthClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Google token exchange failed (HTTP ${res.status}): ${errText.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    expires_in?: number;
    token_type?: string;
  };

  if (!json.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. The OAuth client may already have an active grant — visit https://myaccount.google.com/permissions, revoke the app, then retry.",
    );
  }
  if (!json.access_token) {
    throw new Error("Google did not return an access_token.");
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    scope: json.scope ?? "",
    expiresInSec: json.expires_in ?? 3600,
    tokenType: json.token_type ?? "Bearer",
  };
}

/**
 * List Google Ads customer IDs accessible to this refresh token. Returns
 * 10-digit customer IDs (the `customers/1234567890` resource names are
 * stripped down to just the digits).
 *
 * Note: this is the FLAT list. An MCC user will see every sub-account
 * they manage. The caller decides which ones to import.
 */
export async function listAccessibleCustomers(
  refreshToken: string,
): Promise<string[]> {
  const { clientId, clientSecret, developerToken } = loadOAuthClientConfig();
  const client = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });
  const resp = await client.listAccessibleCustomers(refreshToken);
  // SDK returns { resource_names: ['customers/1234567890', ...] }
  const names: string[] = resp.resource_names ?? [];
  return names.map((rn) => rn.replace(/^customers\//, ""));
}

// ---------------------------------------------------------------------------
// State token — HMAC-signed JSON. Carries the userId + a nonce + a return
// path through the OAuth round-trip so the callback can:
//   1. Verify the response wasn't tampered with (CSRF defense).
//   2. Know which logged-in user the callback belongs to.
//   3. Redirect back to the right page after success.
// ---------------------------------------------------------------------------

const STATE_TTL_SECONDS = 10 * 60; // 10 minutes — generous, since user
                                   // might wrestle with Google's consent screen

type StatePayload = {
  uid: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

function stateSecret(): Buffer {
  const v = process.env.AUTH_SECRET?.trim();
  if (!v) throw new Error("AUTH_SECRET is not set — required for OAuth state HMAC.");
  return Buffer.from(v, "utf8");
}

export function signState(payload: {
  uid: string;
  returnTo?: string;
}): string {
  const body: StatePayload = {
    uid: payload.uid,
    ts: Math.floor(Date.now() / 1000),
    nonce: randomBytes(8).toString("hex"),
    returnTo: payload.returnTo,
  };
  const b64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export type VerifiedState = {
  uid: string;
  returnTo?: string;
};

export function verifyState(token: string): VerifiedState {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Malformed OAuth state token.");
  const [b64, sig] = parts as [string, string];

  const expectedSig = createHmac("sha256", stateSecret()).update(b64).digest("base64url");
  // Constant-time compare so we don't leak signature differences via timing.
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("OAuth state signature mismatch (possible CSRF).");
  }

  const json = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as StatePayload;
  const ageSec = Math.floor(Date.now() / 1000) - json.ts;
  if (ageSec > STATE_TTL_SECONDS) {
    throw new Error(`OAuth state expired (${ageSec}s old > ${STATE_TTL_SECONDS}s).`);
  }
  return { uid: json.uid, returnTo: json.returnTo };
}
