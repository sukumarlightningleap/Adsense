/**
 * GET /api/crm/oauth/[provider]/callback?code=...&state=...
 *
 * Provider redirects here after the user consents. We:
 *   1. Verify state HMAC + extract account/uid
 *   2. Exchange code for tokens
 *   3. Persist CrmOAuthConnection (encrypted)
 *   4. Redirect back to the tracking hub
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  exchangeCodeForTokens,
  saveConnection,
  verifyState,
} from "@/lib/crm/oauth";
import { isCrmProvider } from "@/lib/crm/providers";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isCrmProvider(provider)) {
    return errPage(req, "Unknown CRM provider.");
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return errPage(req, `OAuth declined or failed: ${oauthError}`);
  }
  if (!code || !stateParam) {
    return errPage(req, "Missing code/state in callback.");
  }

  let state: ReturnType<typeof verifyState>;
  try {
    state = verifyState(stateParam);
  } catch (e) {
    return errPage(req, e instanceof Error ? e.message : "Invalid state.");
  }
  if (state.uid !== session.user.id) {
    return errPage(req, "State user mismatch — possible CSRF.");
  }
  if (state.provider !== provider) {
    return errPage(req, "State provider mismatch.");
  }

  // Ownership re-check (the account may have been deleted between
  // start and callback).
  const account = await db.adsAccount.findFirst({
    where: { id: state.accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) {
    return errPage(req, "Account not found or not yours.");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      provider,
      code,
    });
  } catch (e) {
    return errPage(
      req,
      e instanceof Error ? e.message : "Token exchange failed.",
    );
  }

  await saveConnection({
    accountId: account.id,
    provider,
    tokens,
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "crm.oauth_connect",
      targetKind: "ads_account",
      targetId: account.id,
      payload: {
        provider,
        scope: tokens.scope ?? null,
      },
    },
  });

  const back =
    state.returnTo ?? `/app/accounts/${account.id}/conversion-tracking`;
  return NextResponse.redirect(new URL(`${back}?crm=${provider}&connected=1`, req.url));
}

function errPage(req: Request, msg: string) {
  const back = `/app/accounts?error=${encodeURIComponent(msg)}`;
  return NextResponse.redirect(new URL(back, req.url));
}
