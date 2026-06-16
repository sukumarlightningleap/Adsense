/**
 * Google Ads credential profile resolution.
 *
 * Ported from
 * adwords-benchmarks/src/launcher/providers/google_ads/auth.py.
 *
 * Two profiles live side-by-side in the same `.env`:
 *
 *   - 'prod' → reads GOOGLE_ADS_*       (real production MCC)
 *   - 'test' → reads GOOGLE_ADS_TEST_*  (sandbox test MCC)
 *
 * The active profile is picked by `GOOGLE_ADS_PROFILE` (defaults to
 * 'test' for safety — never push to a real account by accident).
 */

export type Profile = "test" | "prod";

export type GoogleAdsCredentials = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** MCC ID — required if you're operating sub-accounts under an MCC. */
  loginCustomerId: string | undefined;
  profile: Profile;
};

/**
 * Which profile is currently active. Defaults to 'test' — safer to
 * accidentally push nothing to a real account than to ship a bug that
 * spends prod money.
 */
export function activeProfile(): Profile {
  const raw = process.env.GOOGLE_ADS_PROFILE?.toLowerCase().trim();
  return raw === "prod" ? "prod" : "test";
}

export function isProdProfile(): boolean {
  return activeProfile() === "prod";
}

/**
 * Load credentials for the active profile. Strips dashes from the MCC
 * ID and returns undefined if it's blank.
 */
export function loadCredentials(): GoogleAdsCredentials {
  const profile = activeProfile();
  const prefix = profile === "test" ? "GOOGLE_ADS_TEST_" : "GOOGLE_ADS_";

  const developerToken = env(`${prefix}DEVELOPER_TOKEN`);
  const clientId = env(`${prefix}CLIENT_ID`);
  const clientSecret = env(`${prefix}CLIENT_SECRET`);
  const refreshToken = env(`${prefix}REFRESH_TOKEN`);
  const loginCustomerIdRaw = env(`${prefix}LOGIN_CUSTOMER_ID`, { optional: true });

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    loginCustomerId: loginCustomerIdRaw
      ? loginCustomerIdRaw.replace(/-/g, "").trim() || undefined
      : undefined,
    profile,
  };
}

function env(
  name: string,
  opts: { optional?: boolean } = {},
): string {
  const v = process.env[name]?.trim();
  if (!v) {
    if (opts.optional) return "";
    throw new Error(
      `Google Ads env var ${name} is not set. Active profile: ${activeProfile()}.`,
    );
  }
  // Strip surrounding quotes if someone wrapped the .env value.
  return v.replace(/^['"]|['"]$/g, "");
}
