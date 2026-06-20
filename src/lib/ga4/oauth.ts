/**
 * Google Analytics 4 OAuth — Phase B5.1.
 *
 * Same patterns as the Google Ads OAuth + CRM OAuth: signed state
 * (HMAC over JSON), AES-256-GCM token vault, transparent refresh ~5
 * minutes before expiry.
 *
 * Scope: `analytics.readonly` — lets us call the GA4 Admin API to list
 * properties + key events. We do NOT request mutation scopes; this
 * connection is read-only.
 *
 * Why a separate connection from Google Ads OAuth: the Ads OAuth has
 * a different scope (`adwords`) and we don't want to force a re-OAuth
 * of the Ads account every time someone wants to link GA4. Users may
 * also have GA4 access on a different Google account than their Ads
 * access (agencies frequently do).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/crypto/token-vault";

const STATE_TTL_SECONDS = 600;
const REFRESH_LEEWAY_MS = 5 * 60 * 1000;
const SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly openid email";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// ===========================================================================
// State (signed, CSRF-defense, identical pattern to ads OAuth)
// ===========================================================================

type StatePayload = {
  uid: string;
  accountId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

function stateSecret(): Buffer {
  const v = process.env.AUTH_SECRET?.trim();
  if (!v) throw new Error("AUTH_SECRET is not set.");
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
  if (parts.length !== 2) throw new Error("Malformed state token.");
  const [b64, sig] = parts as [string, string];
  const expectedSig = createHmac("sha256", stateSecret())
    .update(b64)
    .digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("State signature mismatch (possible CSRF).");
  }
  const json = JSON.parse(
    Buffer.from(b64, "base64url").toString("utf8"),
  ) as StatePayload;
  if (Math.floor(Date.now() / 1000) - json.ts > STATE_TTL_SECONDS) {
    throw new Error("State expired.");
  }
  return json;
}

// ===========================================================================
// Redirect URI + authorize URL
// ===========================================================================

export function redirectUri(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL?.trim()
      ? `https://${process.env.VERCEL_URL.trim()}`
      : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}/api/ga4/oauth/callback`;
}

export function authorizeUrl(state: string): string {
  const clientId = process.env.GA4_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "GA4_OAUTH_CLIENT_ID is not configured. Cannot start GA4 OAuth.",
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ===========================================================================
// Token exchange
// ===========================================================================

export type ExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null;
  scope: string | null;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<ExchangeResult> {
  const clientId = process.env.GA4_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GA4 OAuth client credentials not configured.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `GA4 token exchange failed: ${(json.error_description as string) ?? (json.error as string) ?? res.status}`,
    );
  }
  return {
    accessToken: stringOrThrow(json.access_token, "access_token"),
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSec:
      typeof json.expires_in === "number" ? json.expires_in : null,
    scope: typeof json.scope === "string" ? json.scope : null,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<ExchangeResult> {
  const clientId = process.env.GA4_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GA4 OAuth client credentials not configured.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `GA4 token refresh failed: ${(json.error_description as string) ?? (json.error as string) ?? res.status}`,
    );
  }
  return {
    accessToken: stringOrThrow(json.access_token, "access_token"),
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSec:
      typeof json.expires_in === "number" ? json.expires_in : null,
    scope: typeof json.scope === "string" ? json.scope : null,
  };
}

export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

// ===========================================================================
// Persist + resolve fresh token
// ===========================================================================

export async function saveConnection(opts: {
  accountId: string;
  tokens: ExchangeResult;
  email: string | null;
}) {
  const expiresAt = opts.tokens.expiresInSec
    ? new Date(Date.now() + opts.tokens.expiresInSec * 1000)
    : null;
  return db.ga4OAuthConnection.upsert({
    where: { accountId: opts.accountId },
    create: {
      accountId: opts.accountId,
      encryptedAccessToken: encryptToken(opts.tokens.accessToken),
      encryptedRefreshToken: opts.tokens.refreshToken
        ? encryptToken(opts.tokens.refreshToken)
        : null,
      tokenExpiresAt: expiresAt,
      scope: opts.tokens.scope,
      oauthEmail: opts.email,
    },
    update: {
      encryptedAccessToken: encryptToken(opts.tokens.accessToken),
      ...(opts.tokens.refreshToken
        ? { encryptedRefreshToken: encryptToken(opts.tokens.refreshToken) }
        : {}),
      tokenExpiresAt: expiresAt,
      scope: opts.tokens.scope,
      ...(opts.email ? { oauthEmail: opts.email } : {}),
    },
  });
}

export async function getFreshAccessToken(accountId: string): Promise<string> {
  const conn = await db.ga4OAuthConnection.findFirst({
    where: { accountId },
  });
  if (!conn) throw new Error("No GA4 connection for this account.");
  const expSoon =
    !conn.tokenExpiresAt ||
    conn.tokenExpiresAt.getTime() - Date.now() < REFRESH_LEEWAY_MS;
  if (!expSoon) {
    return decryptToken(conn.encryptedAccessToken);
  }
  if (!conn.encryptedRefreshToken) {
    throw new Error(
      "GA4 access token expired with no refresh token — re-OAuth required.",
    );
  }
  const refresh = decryptToken(conn.encryptedRefreshToken);
  const exchanged = await refreshAccessToken(refresh);
  await saveConnection({
    accountId,
    tokens: exchanged,
    email: conn.oauthEmail,
  });
  return exchanged.accessToken;
}

// ===========================================================================
// Helper
// ===========================================================================

function stringOrThrow(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`OAuth response missing ${field}.`);
  }
  return v;
}
