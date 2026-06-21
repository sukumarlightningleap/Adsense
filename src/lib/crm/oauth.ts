/**
 * Generic CRM OAuth — Phase B6.1.
 *
 * Handles the OAuth code-exchange + refresh-token cycle for HubSpot,
 * Pipedrive, and Zoho. The high-level flow:
 *
 *   1. `/api/crm/oauth/[provider]/start`     → buildState + redirect
 *   2. user consents on the provider's site
 *   3. `/api/crm/oauth/[provider]/callback`  → exchangeCode + persist
 *
 * Then everywhere else: `getAccessToken(connection)` returns a fresh
 * token, refreshing transparently if it's within 5 minutes of expiry.
 *
 * State HMAC + token vault reuse the same primitives as the Google
 * Ads OAuth path.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/crypto/token-vault";

import { CRM_PROVIDERS, type CrmProviderId } from "./providers";

const STATE_TTL_SECONDS = 600;

// ===========================================================================
// State
// ===========================================================================

type StatePayload = {
  uid: string;
  accountId: string;
  provider: CrmProviderId;
  ts: number;
  nonce: string;
  returnTo?: string;
};

function stateSecret(): Buffer {
  const v = process.env.AUTH_SECRET?.trim();
  if (!v)
    throw new Error("AUTH_SECRET is not set — required for OAuth state HMAC.");
  return Buffer.from(v, "utf8");
}

export function signState(payload: Omit<StatePayload, "ts" | "nonce">): string {
  const body: StatePayload = {
    ...payload,
    ts: Math.floor(Date.now() / 1000),
    nonce: randomBytes(8).toString("hex"),
  };
  const b64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", stateSecret())
    .update(b64)
    .digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyState(token: string): StatePayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Malformed OAuth state token.");
  const [b64, sig] = parts as [string, string];
  const expectedSig = createHmac("sha256", stateSecret())
    .update(b64)
    .digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("OAuth state signature mismatch.");
  }
  const json = JSON.parse(
    Buffer.from(b64, "base64url").toString("utf8"),
  ) as StatePayload;
  const ageSec = Math.floor(Date.now() / 1000) - json.ts;
  if (ageSec > STATE_TTL_SECONDS) {
    throw new Error(`OAuth state expired (${ageSec}s old).`);
  }
  return json;
}

// ===========================================================================
// Redirect URI
// ===========================================================================

export function redirectUri(provider: CrmProviderId): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL?.trim()
      ? `https://${process.env.VERCEL_URL.trim()}`
      : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}/api/crm/oauth/${provider}/callback`;
}

// ===========================================================================
// Code exchange
// ===========================================================================

export type ExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null;
  scope: string | null;
  /// Some providers ship metadata in the token response (HubSpot
  /// returns nothing useful; Pipedrive returns `api_domain`; Zoho
  /// returns `api_domain` too). We hand it back so the connection can
  /// store it.
  providerAccountId: string | null;
  raw: Record<string, unknown>;
};

export async function exchangeCodeForTokens(opts: {
  provider: CrmProviderId;
  code: string;
}): Promise<ExchangeResult> {
  const cfg = CRM_PROVIDERS[opts.provider];
  const clientId = process.env[cfg.clientIdEnv]?.trim();
  const clientSecret = process.env[cfg.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `${cfg.clientIdEnv} / ${cfg.clientSecretEnv} not configured.`,
    );
  }
  const tokenUrl =
    typeof cfg.tokenUrl === "function" ? cfg.tokenUrl("us") : cfg.tokenUrl;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(opts.provider),
    code: opts.code,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (json.error_description as string | undefined) ||
      (json.error as string | undefined) ||
      `${res.status}`;
    throw new Error(`${cfg.label} OAuth code exchange failed: ${msg}`);
  }
  return normalizeTokenResponse(opts.provider, json);
}

export async function refreshAccessToken(opts: {
  provider: CrmProviderId;
  refreshToken: string;
}): Promise<ExchangeResult> {
  const cfg = CRM_PROVIDERS[opts.provider];
  const clientId = process.env[cfg.clientIdEnv]?.trim();
  const clientSecret = process.env[cfg.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `${cfg.clientIdEnv} / ${cfg.clientSecretEnv} not configured.`,
    );
  }
  const tokenUrl =
    typeof cfg.tokenUrl === "function" ? cfg.tokenUrl("us") : cfg.tokenUrl;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: opts.refreshToken,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (json.error_description as string | undefined) ||
      (json.error as string | undefined) ||
      `${res.status}`;
    throw new Error(`${cfg.label} token refresh failed: ${msg}`);
  }
  return normalizeTokenResponse(opts.provider, json);
}

function normalizeTokenResponse(
  provider: CrmProviderId,
  json: Record<string, unknown>,
): ExchangeResult {
  const accessToken = stringOrThrow(json.access_token, "access_token");
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
  const expiresInSec =
    typeof json.expires_in === "number" ? json.expires_in : null;
  const scope = typeof json.scope === "string" ? json.scope : null;
  let providerAccountId: string | null = null;
  if (provider === "hubspot") {
    // HubSpot's portal_id requires a separate /oauth/v1/access-tokens/<token>
    // round-trip. We don't need it for the core flow so leave null.
    providerAccountId = null;
  } else if (provider === "pipedrive") {
    providerAccountId =
      (json.api_domain as string | undefined) ?? null;
  }
  return {
    accessToken,
    refreshToken,
    expiresInSec,
    scope,
    providerAccountId,
    raw: json,
  };
}

function stringOrThrow(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`OAuth response missing ${field}.`);
  }
  return v;
}

// ===========================================================================
// Persist
// ===========================================================================

export async function saveConnection(opts: {
  accountId: string;
  provider: CrmProviderId;
  tokens: ExchangeResult;
}) {
  const expiresAt = opts.tokens.expiresInSec
    ? new Date(Date.now() + opts.tokens.expiresInSec * 1000)
    : null;

  return db.crmOAuthConnection.upsert({
    where: {
      uq_crm_oauth_per_provider: {
        accountId: opts.accountId,
        provider: opts.provider,
      },
    },
    create: {
      accountId: opts.accountId,
      provider: opts.provider,
      encryptedAccessToken: encryptToken(opts.tokens.accessToken),
      encryptedRefreshToken: opts.tokens.refreshToken
        ? encryptToken(opts.tokens.refreshToken)
        : null,
      tokenExpiresAt: expiresAt,
      scope: opts.tokens.scope,
      providerAccountId: opts.tokens.providerAccountId,
    },
    update: {
      encryptedAccessToken: encryptToken(opts.tokens.accessToken),
      // Only overwrite the refresh token if the new exchange returned
      // one. Some providers return a refresh token only on the FIRST
      // grant; subsequent refreshes rotate the access but not the
      // refresh.
      ...(opts.tokens.refreshToken
        ? { encryptedRefreshToken: encryptToken(opts.tokens.refreshToken) }
        : {}),
      tokenExpiresAt: expiresAt,
      scope: opts.tokens.scope,
      providerAccountId: opts.tokens.providerAccountId,
    },
  });
}

// ===========================================================================
// Token resolution — used by the poller (caller hands us a connection
// row, we return a fresh access token, refreshing if needed).
// ===========================================================================

const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

export async function getFreshAccessToken(connectionId: string): Promise<string> {
  const conn = await db.crmOAuthConnection.findFirst({
    where: { id: connectionId },
  });
  if (!conn) throw new Error("CRM OAuth connection not found.");

  // Still valid for 5+ minutes? Just decrypt + return.
  const expSoon =
    !conn.tokenExpiresAt ||
    conn.tokenExpiresAt.getTime() - Date.now() < REFRESH_LEEWAY_MS;
  if (!expSoon) {
    return decryptToken(conn.encryptedAccessToken);
  }

  // Need a refresh.
  if (!conn.encryptedRefreshToken) {
    throw new Error(
      "Access token expired but no refresh token stored — re-OAuth required.",
    );
  }
  const refresh = decryptToken(conn.encryptedRefreshToken);
  const exchanged = await refreshAccessToken({
    provider: conn.provider as CrmProviderId,
    refreshToken: refresh,
  });
  await saveConnection({
    accountId: conn.accountId,
    provider: conn.provider as CrmProviderId,
    tokens: exchanged,
  });
  return exchanged.accessToken;
}
