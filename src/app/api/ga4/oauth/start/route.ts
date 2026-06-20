/**
 * GET /api/ga4/oauth/start?accountId=...
 *
 * Starts GA4 OAuth for the user. Verifies they own the target
 * AdsAccount, signs state, redirects to Google's consent screen with
 * `analytics.readonly` scope.
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { authorizeUrl, signState } from "@/lib/ga4/oauth";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(
      new URL(`/sign-in?callbackUrl=${encodeURIComponent(req.url)}`, req.url),
    );
  }
  if (session.user.role === "demo") {
    return NextResponse.redirect(
      new URL("/app/accounts?error=demo_cannot_connect", req.url),
    );
  }
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required." },
      { status: 400 },
    );
  }
  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  const returnTo =
    url.searchParams.get("returnTo") ||
    `/app/accounts/${accountId}/conversion-tracking`;
  try {
    const state = signState({ uid: session.user.id, accountId, returnTo });
    return NextResponse.redirect(authorizeUrl(state));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Authorize URL failed." },
      { status: 500 },
    );
  }
}
