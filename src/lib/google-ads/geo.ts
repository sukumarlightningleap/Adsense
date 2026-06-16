/**
 * Geo resolver — port of
 * adwords-benchmarks/src/launcher/providers/google_ads/geo.py.
 *
 * Turns a wizard `geo` payload into Google Ads
 * `geoTargetConstants/{ID}` resource names that
 * `CampaignCriterion.location.geo_target_constant` accepts.
 *
 * Three scopes:
 *   - nationwide       → one geoTargetConstant for the country
 *   - top_metros       → currently falls back to nationwide (logs warn)
 *                        — proper metro list lands when we wire DMA data
 *   - specific_cities  → SuggestGeoTargetConstants SDK call per city
 */
import type { Customer } from "google-ads-api";

// Country → Google Ads geoTargetConstant ID. Numbers from Google's
// geo-target downloadable CSV. Keep tight; expand on demand.
const COUNTRY_TARGETS: Record<string, number> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  IN: 2356,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  JP: 2392,
};

export type GeoPayload = {
  country: string;
  scope: "nationwide" | "top_metros" | "specific_cities";
  cities?: string[];
};

export async function resolveGeo(
  geo: GeoPayload,
  customer: Customer,
): Promise<string[]> {
  const country = geo.country.toUpperCase();
  const countryId = COUNTRY_TARGETS[country];
  if (!countryId) {
    throw new Error(
      `Unsupported country '${country}'. Add it to COUNTRY_TARGETS in src/lib/google-ads/geo.ts.`,
    );
  }

  if (geo.scope === "nationwide") {
    return [`geoTargetConstants/${countryId}`];
  }

  if (geo.scope === "top_metros") {
    // TODO(phase-5): wire the country → top-N metros DMA list. For now
    // we fall back to nationwide so the campaign still launches.
    console.warn(
      `[geo] top_metros not yet implemented for ${country}; falling back to nationwide.`,
    );
    return [`geoTargetConstants/${countryId}`];
  }

  // specific_cities
  const cities = (geo.cities ?? []).map((c) => c.trim()).filter(Boolean);
  if (cities.length === 0) {
    throw new Error(
      "geo.scope = 'specific_cities' but no cities provided. Add cities or pick another scope.",
    );
  }

  // The SDK exposes `suggestGeoTargetConstants` on the `geoTargetConstants`
  // service. Pass the country code so the suggester biases by locale.
  //
  // Opteo's SDK types this request as a proto-class with a required
  // `toJSON()` method, but at runtime it accepts plain objects. Cast at
  // the boundary so we don't have to instantiate the proto class.
  const request = {
    locale: "en",
    country_code: country,
    location_names: { names: cities },
  } as Parameters<
    typeof customer.geoTargetConstants.suggestGeoTargetConstants
  >[0];
  const response =
    await customer.geoTargetConstants.suggestGeoTargetConstants(request);

  const resolved: string[] = [];
  for (const suggestion of response.geo_target_constant_suggestions ?? []) {
    const c = suggestion.geo_target_constant;
    if (c?.resource_name) {
      resolved.push(c.resource_name);
    }
  }

  if (resolved.length === 0) {
    throw new Error(
      `No geo targets resolved for cities: ${cities.join(", ")}. Check spelling and try again.`,
    );
  }
  return resolved;
}
