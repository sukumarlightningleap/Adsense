/**
 * GET /api/google-ads/oauth/callback
 *
 * Google redirects here after the user consents (or cancels). On success:
 *   1. Verify the state HMAC (CSRF + ties back to the right user).
 *   2. Exchange the code for refresh + access tokens.
 *   3. Ask Google which customer accounts this token can see.
 *   4. Upsert one AdsAccount row per accessible customer with the
 *      encrypted refresh token.
 *   5. Redirect back to /app/accounts with `?connected=N`.
 *
 * Day 1: we stop after storing credentials. The actual data import job
 * (Campaigns + AdGroups + Assets + ConversionActions + ...) runs from
 * the dashboard "Import now" button — built in Day 2.
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  exchangeCodeForTokens,
  listAccessibleCustomers,
  verifyState,
} from "@/lib/google-ads/oauth";
import { encryptToken } from "@/lib/crypto/token-vault";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");

  // The user clicked "Cancel" on Google's consent screen — no-op redirect.
  if (oauthErr) {
    return NextResponse.redirect(
      new URL(`/app/accounts?error=${encodeURIComponent(oauthErr)}`, req.url),
    );
  }
  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL("/app/accounts?error=missing_code_or_state", req.url),
    );
  }

  // Verify state and identify the user. We accept the state's uid as the
  // source of truth — if the user's session changed mid-flow, that's fine
  // as long as the state HMAC checks out, because the state was created
  // by us and we're upserting against the uid embedded in it.
  let verified: { uid: string; returnTo?: string };
  try {
    verified = verifyState(stateParam);
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/app/accounts?error=invalid_state`, req.url),
    );
  }

  // Sanity check — also require an active session to limit replay risk.
  const session = await auth();
  if (!session?.user || session.user.id !== verified.uid) {
    return NextResponse.redirect(
      new URL("/app/accounts?error=session_mismatch", req.url),
    );
  }

  // Exchange code for tokens.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return NextResponse.redirect(
      new URL(`/app/accounts?error=${encodeURIComponent(msg.slice(0, 200))}`, req.url),
    );
  }

  // Discover what customers this token can see.
  let accessibleCustomers: string[];
  try {
    accessibleCustomers = await listAccessibleCustomers(tokens.refreshToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list_customers_failed";
    return NextResponse.redirect(
      new URL(`/app/accounts?error=${encodeURIComponent(msg.slice(0, 200))}`, req.url),
    );
  }

  if (accessibleCustomers.length === 0) {
    return NextResponse.redirect(
      new URL("/app/accounts?error=no_accessible_customers", req.url),
    );
  }

  // Encrypt the refresh token ONCE — same ciphertext written to every
  // upserted row, since the token grants access to every customer the
  // OAuth user can see. (When the user re-auths or revokes, we mint a
  // new ciphertext on the next round-trip.)
  const cipherText = encryptToken(tokens.refreshToken);
  const now = new Date();

  // Upsert one row per accessible customer. We use the existing
  // (userId, provider, customerId) unique constraint as the conflict target.
  let upserted = 0;
  for (const customerId of accessibleCustomers) {
    await db.adsAccount.upsert({
      where: {
        uq_account_user_provider_customer: {
          userId: verified.uid,
          provider: "google_ads",
          customerId,
        },
      },
      create: {
        userId: verified.uid,
        provider: "google_ads",
        customerId,
        descriptiveName: null, // filled by the import job in Day 2
        oauthRefreshToken: cipherText,
        oauthScope: tokens.scope,
        connectionStatus: "connected",
        connectedAt: now,
        demoMode: false,
      },
      update: {
        oauthRefreshToken: cipherText,
        oauthScope: tokens.scope,
        connectionStatus: "connected",
        connectedAt: now,
      },
    });
    upserted += 1;
  }

  await db.auditLog.create({
    data: {
      userId: verified.uid,
      action: "ads_account.oauth_connect",
      targetKind: "ads_account",
      payload: {
        accessibleCustomers,
        scope: tokens.scope,
      },
    },
  });

  const returnTo = verified.returnTo || "/app/accounts";
  return NextResponse.redirect(
    new URL(`${returnTo}?connected=${upserted}`, req.url),
  );
}
