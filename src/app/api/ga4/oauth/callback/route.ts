/**
 * GET /api/ga4/oauth/callback?code=...&state=...
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  exchangeCodeForTokens,
  fetchUserEmail,
  saveConnection,
  verifyState,
} from "@/lib/ga4/oauth";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return errPage(req, `OAuth declined: ${oauthError}`);
  if (!code || !stateParam) return errPage(req, "Missing code/state.");

  let state;
  try {
    state = verifyState(stateParam);
  } catch (e) {
    return errPage(req, e instanceof Error ? e.message : "Invalid state.");
  }
  if (state.uid !== session.user.id) {
    return errPage(req, "State user mismatch.");
  }
  const account = await db.adsAccount.findFirst({
    where: { id: state.accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) return errPage(req, "Account not found.");

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    return errPage(req, e instanceof Error ? e.message : "Token exchange failed.");
  }
  const email = await fetchUserEmail(tokens.accessToken);
  await saveConnection({
    accountId: account.id,
    tokens,
    email,
  });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ga4.oauth_connect",
      targetKind: "ads_account",
      targetId: account.id,
      payload: { oauthEmail: email, scope: tokens.scope ?? null },
    },
  });
  const back =
    state.returnTo ?? `/app/accounts/${account.id}/conversion-tracking`;
  return NextResponse.redirect(new URL(`${back}?ga4=connected`, req.url));
}

function errPage(req: Request, msg: string) {
  return NextResponse.redirect(
    new URL(`/app/accounts?error=${encodeURIComponent(msg)}`, req.url),
  );
}
