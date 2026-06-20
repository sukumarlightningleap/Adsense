/**
 * GA4 Admin API client — Phase B5.1.
 *
 * Wraps the two endpoints we need to power the Hub's GA4-import flow:
 *
 *   - listAccessibleProperties() → returns every GA4 property the
 *     OAuth user can read (uses `accountSummaries`).
 *   - listKeyEvents(propertyId) → returns the events marked as "key
 *     events" / conversions in that property.
 *
 * We use the v1beta surface — that's where keyEvents was introduced
 * after Google renamed "conversions" to "key events" in late 2024.
 */
import { getFreshAccessToken } from "./oauth";

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";

export type Ga4Property = {
  /// `properties/123456789`
  resourceName: string;
  /// `123456789` (numeric, what we store)
  propertyId: string;
  displayName: string;
  accountName: string;
  parent: string;            // 'accounts/{id}'
};

export type Ga4KeyEvent = {
  /// `properties/{p}/keyEvents/{id}`
  resourceName: string;
  eventName: string;
  countingMethod: "ONCE_PER_EVENT" | "ONCE_PER_SESSION" | string;
};

// ===========================================================================
// List properties — via accountSummaries (one round-trip for every account
// + the user's properties under each).
// ===========================================================================

export async function listAccessibleProperties(
  accountId: string,
): Promise<Ga4Property[]> {
  const token = await getFreshAccessToken(accountId);
  type Resp = {
    accountSummaries?: Array<{
      account?: string;          // 'accounts/{id}'
      displayName?: string;
      propertySummaries?: Array<{
        property?: string;       // 'properties/{id}'
        displayName?: string;
      }>;
    }>;
    nextPageToken?: string;
  };
  const out: Ga4Property[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const url = new URL(`${ADMIN_BASE}/accountSummaries`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GA4 accountSummaries failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as Resp;
    for (const a of json.accountSummaries ?? []) {
      const accountName = a.displayName ?? a.account ?? "—";
      for (const p of a.propertySummaries ?? []) {
        if (!p.property) continue;
        const propertyId = p.property.replace(/^properties\//, "");
        out.push({
          resourceName: p.property,
          propertyId,
          displayName: p.displayName ?? "—",
          accountName,
          parent: a.account ?? "",
        });
      }
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

// ===========================================================================
// List key events for a property
// ===========================================================================

export async function listKeyEvents(opts: {
  accountId: string;
  propertyId: string;
}): Promise<Ga4KeyEvent[]> {
  const token = await getFreshAccessToken(opts.accountId);
  type Resp = {
    keyEvents?: Array<{
      name?: string;
      eventName?: string;
      countingMethod?: string;
    }>;
    nextPageToken?: string;
  };
  const out: Ga4KeyEvent[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const url = new URL(
      `${ADMIN_BASE}/properties/${opts.propertyId}/keyEvents`,
    );
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Some properties still expose the older `conversionEvents` endpoint.
      // Fall back to it once.
      if (i === 0 && res.status === 404) {
        return listConversionEventsFallback(token, opts.propertyId);
      }
      const text = await res.text().catch(() => "");
      throw new Error(`GA4 keyEvents failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as Resp;
    for (const ev of json.keyEvents ?? []) {
      if (!ev.eventName || !ev.name) continue;
      out.push({
        resourceName: ev.name,
        eventName: ev.eventName,
        countingMethod: (ev.countingMethod as Ga4KeyEvent["countingMethod"]) ?? "ONCE_PER_EVENT",
      });
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

async function listConversionEventsFallback(
  token: string,
  propertyId: string,
): Promise<Ga4KeyEvent[]> {
  type Resp = {
    conversionEvents?: Array<{
      name?: string;
      eventName?: string;
      countingMethod?: string;
    }>;
  };
  const res = await fetch(
    `${ADMIN_BASE}/properties/${propertyId}/conversionEvents?pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 conversionEvents failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as Resp;
  return (json.conversionEvents ?? [])
    .filter((c) => c.eventName && c.name)
    .map((c) => ({
      resourceName: c.name!,
      eventName: c.eventName!,
      countingMethod: (c.countingMethod as Ga4KeyEvent["countingMethod"]) ?? "ONCE_PER_EVENT",
    }));
}
