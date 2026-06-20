/**
 * CRM provider configurations — Phase B6.1.
 *
 * Per-provider OAuth + API endpoint definitions. Each provider has a
 * different auth URL, token URL, scope syntax, API base, and pagination
 * pattern — but they all expose the same "list pipelines / list stages
 * / list recently-updated deals" surface, which we normalize behind a
 * single CrmAdapter interface.
 *
 * The adapter functions accept an `accessToken` (the caller decrypts
 * the stored token first) plus the connection's `region` (Zoho-only)
 * and return normalized shapes the poller can iterate.
 */

export type CrmProviderId = "hubspot" | "pipedrive" | "zoho";

export type ZohoRegion = "us" | "eu" | "in" | "au" | "jp";

export type NormalizedDeal = {
  id: string;                       // Provider-side deal ID
  stageId: string;                  // Pipeline stage ID (or name for pipedrive)
  stageName: string;
  pipelineId: string;
  amount: number | null;
  currency: string | null;
  updatedAt: Date;
  /// gclid extracted from the deal's contact/lead. Optional — the
  /// customer must surface gclid as a custom field on the deal/contact
  /// (we look up a few common conventions: 'gclid', 'google_click_id',
  /// 'utm_gclid'). Without one we can't attribute to Google.
  gclid: string | null;
};

export type NormalizedPipeline = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
};

export type CrmProviderConfig = {
  id: CrmProviderId;
  label: string;
  /// OAuth authorization URL (without query params).
  authUrl: string | ((region: ZohoRegion) => string);
  /// OAuth token exchange URL.
  tokenUrl: string | ((region: ZohoRegion) => string);
  /// Space-separated scopes to request.
  scope: string;
  /// Env var name holding the client ID.
  clientIdEnv: string;
  /// Env var name holding the client secret.
  clientSecretEnv: string;
  /// Whether the provider requires a region picker (Zoho only).
  needsRegion: boolean;
};

export const CRM_PROVIDERS: Record<CrmProviderId, CrmProviderConfig> = {
  hubspot: {
    id: "hubspot",
    label: "HubSpot",
    authUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scope: "crm.objects.deals.read crm.schemas.deals.read oauth",
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
    needsRegion: false,
  },
  pipedrive: {
    id: "pipedrive",
    label: "Pipedrive",
    authUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    scope: "deals:read contacts:read",
    clientIdEnv: "PIPEDRIVE_CLIENT_ID",
    clientSecretEnv: "PIPEDRIVE_CLIENT_SECRET",
    needsRegion: false,
  },
  zoho: {
    id: "zoho",
    label: "Zoho CRM",
    // Zoho uses region-specific data centers — accounts.zoho.<tld>.
    authUrl: (region) => `https://accounts.zoho.${zohoTld(region)}/oauth/v2/auth`,
    tokenUrl: (region) =>
      `https://accounts.zoho.${zohoTld(region)}/oauth/v2/token`,
    scope: "ZohoCRM.modules.deals.READ ZohoCRM.modules.contacts.READ",
    clientIdEnv: "ZOHO_CLIENT_ID",
    clientSecretEnv: "ZOHO_CLIENT_SECRET",
    needsRegion: true,
  },
};

export function isCrmProvider(s: string): s is CrmProviderId {
  return s === "hubspot" || s === "pipedrive" || s === "zoho";
}

export function zohoTld(region: ZohoRegion): string {
  switch (region) {
    case "eu":
      return "eu";
    case "in":
      return "in";
    case "au":
      return "com.au";
    case "jp":
      return "jp";
    case "us":
    default:
      return "com";
  }
}

/**
 * Per-provider API base for data calls (post-OAuth). For Zoho this
 * depends on region.
 */
export function apiBase(provider: CrmProviderId, region?: string | null): string {
  if (provider === "hubspot") return "https://api.hubapi.com";
  if (provider === "pipedrive") return "https://api.pipedrive.com";
  // Zoho: data calls go to `www.zohoapis.<tld>`.
  const r = (region ?? "us") as ZohoRegion;
  return `https://www.zohoapis.${zohoTld(r)}`;
}

/**
 * Build the authorize URL for a provider.
 */
export function authorizeUrl(opts: {
  provider: CrmProviderId;
  region?: ZohoRegion;
  state: string;
  redirectUri: string;
}): string {
  const cfg = CRM_PROVIDERS[opts.provider];
  const clientId = process.env[cfg.clientIdEnv]?.trim();
  if (!clientId) {
    throw new Error(
      `${cfg.clientIdEnv} not configured. Cannot start ${cfg.label} OAuth.`,
    );
  }
  const base =
    typeof cfg.authUrl === "function"
      ? cfg.authUrl(opts.region ?? "us")
      : cfg.authUrl;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: cfg.scope,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `${base}?${params.toString()}`;
}
