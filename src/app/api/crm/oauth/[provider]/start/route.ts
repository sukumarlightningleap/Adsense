/**
 * GET /api/crm/oauth/[provider]/start?accountId=...&region=us
 *
 * Kicks off the OAuth flow for HubSpot / Pipedrive / Zoho. Verifies the
 * caller owns the target AdsAccount, signs state, redirects to the
 * provider's consent screen.
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  authorizeUrl,
  isCrmProvider,
  type ZohoRegion,
} from "@/lib/crm/providers";
import { redirectUri, signState } from "@/lib/crm/oauth";

const ZOHO_REGIONS: ZohoRegion[] = ["us", "eu", "in", "au", "jp"];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isCrmProvider(provider)) {
    return NextResponse.json(
      { error: "Unknown CRM provider." },
      { status: 400 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    const back = encodeURIComponent(req.url);
    return NextResponse.redirect(
      new URL(`/sign-in?callbackUrl=${back}`, req.url),
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
      { error: "accountId query parameter is required." },
      { status: 400 },
    );
  }

  const account = await db.adsAccount.findFirst({
    where: { id: accountId, userId: session.user.id, demoMode: false },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Account not found or not yours." },
      { status: 404 },
    );
  }

  const regionRaw = url.searchParams.get("region");
  const region =
    provider === "zoho" && regionRaw && ZOHO_REGIONS.includes(regionRaw as ZohoRegion)
      ? (regionRaw as ZohoRegion)
      : provider === "zoho"
        ? "us"
        : undefined;

  const returnTo =
    url.searchParams.get("returnTo") ||
    `/app/accounts/${accountId}/conversion-tracking`;

  let consentUrl: string;
  try {
    const state = signState({
      uid: session.user.id,
      accountId,
      provider,
      region,
      returnTo,
    });
    consentUrl = authorizeUrl({
      provider,
      region,
      state,
      redirectUri: redirectUri(provider),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Failed to build authorize URL",
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(consentUrl);
}
