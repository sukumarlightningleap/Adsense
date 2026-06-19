/**
 * GET /api/google-ads/oauth/start
 *
 * Kicks off the Google Ads OAuth flow:
 *   1. Verify the caller is signed in to Adsense (and not a demo user).
 *   2. Sign a state token tying this request to the current user.
 *   3. Redirect to Google's consent screen.
 *
 * The user lands at /api/google-ads/oauth/callback after consenting.
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { buildAuthorizationUrl, signState } from "@/lib/google-ads/oauth";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    const back = encodeURIComponent("/app/accounts");
    return NextResponse.redirect(new URL(`/sign-in?callbackUrl=${back}`, req.url));
  }
  if (session.user.role === "demo") {
    return NextResponse.redirect(
      new URL("/app/accounts?error=demo_cannot_connect", req.url),
    );
  }

  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo") || "/app/accounts";

  const state = signState({ uid: session.user.id, returnTo });
  const consentUrl = buildAuthorizationUrl(state);

  return NextResponse.redirect(consentUrl);
}
