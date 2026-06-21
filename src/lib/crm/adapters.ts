/**
 * Per-CRM data adapters — Phase B6.1.
 *
 * Each adapter exposes the same shape:
 *   - listPipelines(token, region?)
 *   - listRecentDeals(token, sinceDate, region?)
 *
 * Normalization rules:
 *   - HubSpot: deals returned with their `dealstage` (stage ID) +
 *     `hs_lastmodifieddate`. Pipelines fetched separately to label
 *     stage IDs. gclid lives on the associated contact's `hs_google_ad_click_id`
 *     property (HubSpot's standard ads-tracking field) OR a custom
 *     `gclid` property; we try the standard first.
 *   - Pipedrive: deals have `stage_id` + `update_time`. gclid usually
 *     in a custom field; we look for any custom field whose key matches
 *     `gclid` / `google_click_id` / `utm_gclid`.
 *   - Zoho: deals have `Stage` (string, not ID) + `Modified_Time`.
 *     gclid in a custom field — same convention as Pipedrive.
 *
 * These return up to PAGE_LIMIT deals per call. The poller loops if
 * the API indicates more pages.
 */
import {
  apiBase,
  type CrmProviderId,
  type NormalizedDeal,
  type NormalizedPipeline,
} from "./providers";

const PAGE_LIMIT = 100;

const GCLID_FIELD_KEYS = [
  "gclid",
  "google_click_id",
  "utm_gclid",
  "hs_google_ad_click_id",
] as const;

// ===========================================================================
// Public entry points
// ===========================================================================

export async function listPipelines(opts: {
  provider: CrmProviderId;
  accessToken: string;
  region?: string | null;
}): Promise<NormalizedPipeline[]> {
  switch (opts.provider) {
    case "hubspot":
      return listHubspotPipelines(opts.accessToken);
    case "pipedrive":
      return listPipedrivePipelines(opts.accessToken);
    case "zoho":
      return listZohoLayouts(opts.accessToken, opts.region);
  }
}

export async function listRecentDeals(opts: {
  provider: CrmProviderId;
  accessToken: string;
  sinceDate: Date;
  region?: string | null;
}): Promise<NormalizedDeal[]> {
  switch (opts.provider) {
    case "hubspot":
      return listHubspotDeals(opts.accessToken, opts.sinceDate);
    case "pipedrive":
      return listPipedriveDeals(opts.accessToken, opts.sinceDate);
    case "zoho":
      return listZohoDeals(opts.accessToken, opts.sinceDate, opts.region);
  }
}

// ===========================================================================
// HubSpot
// ===========================================================================

async function listHubspotPipelines(
  accessToken: string,
): Promise<NormalizedPipeline[]> {
  type Resp = {
    results: Array<{
      id: string;
      label: string;
      stages: Array<{ id: string; label: string }>;
    }>;
  };
  const res = await fetch(`${apiBase("hubspot")}/crm/v3/pipelines/deals`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`HubSpot pipelines fetch failed: ${res.status}`);
  const json = (await res.json()) as Resp;
  return json.results.map((p) => ({
    id: p.id,
    name: p.label,
    stages: p.stages.map((s) => ({ id: s.id, name: s.label })),
  }));
}

async function listHubspotDeals(
  accessToken: string,
  since: Date,
): Promise<NormalizedDeal[]> {
  // HubSpot CRM Search API — POST /crm/v3/objects/deals/search.
  type Resp = {
    results: Array<{
      id: string;
      properties: Record<string, string | null>;
    }>;
  };
  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "hs_lastmodifieddate",
            operator: "GTE",
            value: since.getTime().toString(),
          },
        ],
      },
    ],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
    properties: [
      "dealname",
      "dealstage",
      "pipeline",
      "amount",
      "amount_in_home_currency",
      "deal_currency_code",
      "hs_lastmodifieddate",
      ...GCLID_FIELD_KEYS,
    ],
    limit: PAGE_LIMIT,
  };
  const res = await fetch(
    `${apiBase("hubspot")}/crm/v3/objects/deals/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot deal search failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as Resp;

  // Pull stage labels lazily — we already query pipelines for UI; the
  // poller re-uses them by joining stageId. We omit stageName here and
  // let the poller pass it through from the rules map.
  return json.results.map((d) => ({
    id: d.id,
    stageId: d.properties.dealstage ?? "",
    stageName: d.properties.dealstage ?? "",
    pipelineId: d.properties.pipeline ?? "",
    amount: numericProperty(d.properties.amount),
    currency: d.properties.deal_currency_code ?? null,
    updatedAt: tsProperty(d.properties.hs_lastmodifieddate),
    gclid: pickGclid(d.properties),
  }));
}

// ===========================================================================
// Pipedrive
// ===========================================================================

async function listPipedrivePipelines(
  accessToken: string,
): Promise<NormalizedPipeline[]> {
  // Pipedrive v2 pipelines API.
  type PipelineResp = {
    data: Array<{ id: number; name: string }>;
  };
  type StageResp = {
    data: Array<{
      id: number;
      name: string;
      pipeline_id: number;
    }>;
  };
  const pRes = await fetch(`${apiBase("pipedrive")}/api/v2/pipelines`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!pRes.ok) throw new Error(`Pipedrive pipelines failed: ${pRes.status}`);
  const pJson = (await pRes.json()) as PipelineResp;
  const pipelines = pJson.data ?? [];

  const sRes = await fetch(`${apiBase("pipedrive")}/api/v2/stages`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!sRes.ok) throw new Error(`Pipedrive stages failed: ${sRes.status}`);
  const sJson = (await sRes.json()) as StageResp;

  return pipelines.map((p) => ({
    id: String(p.id),
    name: p.name,
    stages: (sJson.data ?? [])
      .filter((st) => st.pipeline_id === p.id)
      .map((st) => ({ id: String(st.id), name: st.name })),
  }));
}

async function listPipedriveDeals(
  accessToken: string,
  since: Date,
): Promise<NormalizedDeal[]> {
  // Pipedrive v2 deals API supports `updated_since` parameter (ISO-8601).
  type Resp = {
    data?: Array<{
      id: number;
      stage_id: number;
      pipeline_id: number;
      value?: number;
      currency?: string;
      update_time?: string;
      person_id?: { value: number; name: string } | null;
      [custom: string]: unknown;
    }>;
  };
  // Pipedrive v2 expects RFC 3339 (T separator + Z, no millis) for
  // `updated_since`. Format helper at the bottom of this file.
  const url = new URL(`${apiBase("pipedrive")}/api/v2/deals`);
  url.searchParams.set("updated_since", formatPipedriveDateTime(since));
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("sort_by", "update_time");
  url.searchParams.set("sort_direction", "asc");

  // Resolve which deal-field hash key corresponds to the user's
  // "gclid"-named custom field. Pipedrive returns custom field values
  // keyed by hash, not display name — so we have to map field
  // definitions first or we'll never see the value the user pasted.
  // (`dealFields` is still a v1 endpoint as of Pipedrive's v2 rollout.)
  const gclidFieldKey = await resolvePipedriveGclidFieldKey(accessToken).catch(
    () => null,
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pipedrive deal list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as Resp;
  return (json.data ?? []).map((d) => {
    const flatGclid = pickGclid(d as Record<string, unknown>);
    const customFields =
      typeof d.custom_fields === "object" && d.custom_fields !== null
        ? (d.custom_fields as Record<string, unknown>)
        : null;
    const customFieldGclid = customFields
      ? pickGclid(customFields) ??
        (gclidFieldKey && typeof customFields[gclidFieldKey] === "string"
          ? (customFields[gclidFieldKey] as string)
          : null)
      : null;
    return {
      id: String(d.id),
      stageId: String(d.stage_id),
      stageName: String(d.stage_id),
      pipelineId: String(d.pipeline_id),
      amount: typeof d.value === "number" ? d.value : null,
      currency: typeof d.currency === "string" ? d.currency : null,
      updatedAt: d.update_time ? new Date(d.update_time) : new Date(),
      gclid: flatGclid ?? customFieldGclid,
    };
  });
}

/**
 * Walk Pipedrive's deal-field definitions and return the hash key of
 * any field named/labelled like `gclid` or `google_click_id`. Returns
 * null if no matching field exists or the API call fails (caller
 * already swallows errors).
 */
async function resolvePipedriveGclidFieldKey(
  accessToken: string,
): Promise<string | null> {
  type FieldsResp = {
    data?: Array<{
      key?: string;
      name?: string;
    }>;
  };
  const res = await fetch(`${apiBase("pipedrive")}/api/v1/dealFields`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as FieldsResp;
  for (const f of json.data ?? []) {
    const name = f.name?.toLowerCase() ?? "";
    if (
      name === "gclid" ||
      name === "google click id" ||
      name === "google_click_id" ||
      name.includes("gclid") ||
      name.includes("google click")
    ) {
      return f.key ?? null;
    }
  }
  return null;
}

// ===========================================================================
// Zoho
// ===========================================================================

async function listZohoLayouts(
  accessToken: string,
  region: string | null | undefined,
): Promise<NormalizedPipeline[]> {
  // Zoho doesn't have "pipelines" in the HubSpot sense; it has Layouts +
  // pick-list values for the `Stage` field on Deals. We approximate
  // pipelines by listing the Deals module's pick-list values.
  type Resp = {
    fields?: Array<{
      api_name?: string;
      pick_list_values?: Array<{ display_value: string; actual_value: string }>;
    }>;
  };
  const res = await fetch(
    `${apiBase("zoho", region)}/crm/v6/settings/fields?module=Deals`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );
  if (!res.ok) throw new Error(`Zoho fields fetch failed: ${res.status}`);
  const json = (await res.json()) as Resp;
  const stageField = (json.fields ?? []).find((f) => f.api_name === "Stage");
  const stages = (stageField?.pick_list_values ?? []).map((s) => ({
    id: s.actual_value,
    name: s.display_value,
  }));
  return [
    {
      id: "default",
      name: "Deals",
      stages,
    },
  ];
}

async function listZohoDeals(
  accessToken: string,
  since: Date,
  region: string | null | undefined,
): Promise<NormalizedDeal[]> {
  type Resp = {
    data?: Array<{
      id: string;
      Stage?: string;
      Amount?: number;
      Modified_Time?: string;
      [custom: string]: unknown;
    }>;
  };
  // Zoho's Modified_Since header gates the response. We also sort by
  // Modified_Time asc so pagination is deterministic.
  const url = new URL(`${apiBase("zoho", region)}/crm/v6/Deals`);
  url.searchParams.set("per_page", String(PAGE_LIMIT));
  url.searchParams.set("sort_by", "Modified_Time");
  url.searchParams.set("sort_order", "asc");
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "If-Modified-Since": since.toUTCString(),
    },
  });
  if (res.status === 304) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoho deal list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as Resp;
  return (json.data ?? []).map((d) => ({
    id: d.id,
    stageId: d.Stage ?? "",
    stageName: d.Stage ?? "",
    pipelineId: "default",
    amount: typeof d.Amount === "number" ? d.Amount : null,
    currency: null,
    updatedAt: d.Modified_Time ? new Date(d.Modified_Time) : new Date(),
    gclid: pickGclid(d as Record<string, unknown>),
  }));
}

// ===========================================================================
// Helpers
// ===========================================================================

function pickGclid(props: Record<string, unknown>): string | null {
  // Exact key match first.
  for (const key of GCLID_FIELD_KEYS) {
    const v = props[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // Pattern match on string values at the top level.
  for (const [k, v] of Object.entries(props)) {
    if (typeof v !== "string" || v.length === 0) continue;
    const lk = k.toLowerCase();
    if (lk.includes("gclid") || lk.includes("google_click")) return v;
  }
  // Recurse ONE level into nested objects — Pipedrive v2 nests custom
  // fields under `custom_fields` with hashed keys, but if any property
  // in there is named-like-a-gclid we'll catch it.
  for (const v of Object.values(props)) {
    if (typeof v !== "object" || v === null) continue;
    if (Array.isArray(v)) continue;
    const nested = v as Record<string, unknown>;
    for (const key of GCLID_FIELD_KEYS) {
      const nv = nested[key];
      if (typeof nv === "string" && nv.length > 0) return nv;
    }
    for (const [k, nv] of Object.entries(nested)) {
      if (typeof nv !== "string" || nv.length === 0) continue;
      const lk = k.toLowerCase();
      if (lk.includes("gclid") || lk.includes("google_click")) return nv;
    }
  }
  return null;
}

function numericProperty(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsProperty(v: string | null | undefined): Date {
  if (!v) return new Date();
  const ms = Number(v);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// Pipedrive v2 expects RFC 3339 in the form `2025-01-01T10:20:00Z` —
// T separator, Z suffix, NO fractional seconds (the default
// Date.toISOString() includes `.000` which Pipedrive rejects with a
// "not a valid datetime" 400).
function formatPipedriveDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
