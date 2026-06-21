"use client";

/**
 * Conversion Tracking Hub — the single-pane-of-glass view of every
 * ConversionAction on the account, regardless of source.
 *
 *   - List of all actions: name, source pill, category, health, primary
 *     toggle, snippet button, pause/enable
 *   - "+ Add conversion" → opens the create sheet (Phase B2 only covers
 *     "Website tag (gtag/GTM)" + "Phone call (Google native)" today;
 *     CRM / GA4 link / Phone-via-Twilio show as "coming soon" so the
 *     full source map is visible to the customer)
 *   - Per-row "Snippet" → opens a sheet showing the gtag base tag, the
 *     event tag, the no-script fallback, and a GTM trigger JSON
 *
 * No external sheet/dialog primitive yet in the project — we render
 * lightweight in-place modals with absolute positioning + a backdrop.
 */
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  HelpCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  StarOff,
  Tag,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { ConversionCategory } from "@prisma/client";
import type { ConversionHealthStatus } from "@/lib/google-ads/health";

import {
  bindCrmFeedAction,
  checkFire,
  createConversionAction,
  createGa4Conversion,
  disconnectCrmOauth,
  disconnectGa4,
  getCrmConfig,
  getCrmOAuthState,
  getGa4ConnectionState,
  getSnippets,
  listCrmPipelines,
  listGa4KeyEvents,
  listGa4Properties,
  markTagInstalled,
  pollCrmNow,
  rotateCrmSecret,
  saveStageRules,
  setPrimary,
  setStatus,
  uploadCsvConversions,
  type CrmConfigState,
  type CrmOAuthState,
  type Ga4ConnectionState,
} from "./actions";
import type { CrmSource } from "@/lib/google-ads/crm-webhooks";
import type { NormalizedPipeline } from "@/lib/crm/providers";
import type { Ga4KeyEvent, Ga4Property } from "@/lib/ga4/admin";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type HubRow = {
  id: string;
  name: string;
  category: string;
  status: string;                  // CampaignStatus enum value
  isPrimary: boolean;
  source: "created" | "imported";
  tagInstalled: boolean;
  countingType: string | null;
  valueUsd: number | null;
  lookbackDays: number | null;
  // From health.ts
  health: ConversionHealthStatus;
  reason: string;
  daysSinceLastFire: number | null;
  recentConversions: number | null;
  providerConversionId: string | null;
};

const CATEGORY_LABELS: Record<ConversionCategory, string> = {
  PAGE_VIEW: "Page view",
  PURCHASE: "Purchase",
  SIGNUP: "Signup",
  LEAD: "Lead",
  DOWNLOAD: "Download",
  STORE_VISIT: "Store visit",
  STORE_SALE: "Store sale",
  PHONE_CALL_LEAD: "Phone call lead",
  IMPORTED_LEAD: "Imported lead (offline)",
  SUBMIT_LEAD_FORM: "Lead form submit",
  BOOK_APPOINTMENT: "Booking",
  REQUEST_QUOTE: "Quote request",
  ADD_TO_CART: "Add to cart",
  BEGIN_CHECKOUT: "Begin checkout",
  SUBSCRIBE_PAID: "Paid subscription",
  CONTACT: "Contact",
  GET_DIRECTIONS: "Get directions",
  OTHER: "Other",
};

const CREATABLE_CATEGORIES: ConversionCategory[] = [
  "SUBMIT_LEAD_FORM",
  "PURCHASE",
  "SIGNUP",
  "BOOK_APPOINTMENT",
  "REQUEST_QUOTE",
  "CONTACT",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "DOWNLOAD",
  "PHONE_CALL_LEAD",
  "PAGE_VIEW",
  "OTHER",
];

type SourceOption = {
  id:
    | "website_tag"
    | "google_tag_manager"
    | "phone_call"
    | "ga4_link"
    | "crm"
    | "offline_csv";
  label: string;
  helper: string;
  icon: typeof Tag;
  available: boolean;
};

const SOURCE_OPTIONS: SourceOption[] = [
  {
    id: "website_tag",
    label: "Website tag (gtag.js)",
    helper:
      "Most common. We give you a small snippet to paste on your site — fires when a customer submits a form or completes checkout.",
    icon: Tag,
    available: true,
  },
  {
    id: "google_tag_manager",
    label: "Google Tag Manager",
    helper:
      "Same firing logic — packaged as a GTM trigger config you import into your container instead of pasting in HTML.",
    icon: Code2,
    available: true,
  },
  {
    id: "phone_call",
    label: "Phone call from ad",
    helper:
      "Google uses a forwarded tracking number on call-only ads. Pick this when calls are the conversion you care about.",
    icon: ShieldCheck,
    available: true,
  },
  {
    id: "ga4_link",
    label: "Google Analytics 4",
    helper:
      "Use a GA4 event as a conversion. Requires Ads ↔ GA4 link in Google Admin first.",
    icon: Sparkles,
    available: true,
  },
  {
    id: "crm",
    label: "CRM offline upload (HubSpot / Pipedrive / Zoho)",
    helper:
      "When a lead becomes qualified in your CRM, your CRM POSTs to our webhook URL. We batch-upload to Google every 15 minutes.",
    icon: Zap,
    available: true,
  },
  {
    id: "offline_csv",
    label: "Offline CSV upload",
    helper:
      "Upload a list of {gclid, conversion date} from your internal system. Good for back-fills + custom integrations.",
    icon: ShieldCheck,
    available: true,
  },
];

// ---------------------------------------------------------------------------
// Top-level hub
// ---------------------------------------------------------------------------

export function ConversionTrackingHub({
  accountId,
  accountName,
  isManager,
  isDemo,
  currencyCode,
  rows,
}: {
  accountId: string;
  accountName: string;
  isManager: boolean;
  isDemo: boolean;
  currencyCode: string;
  rows: HubRow[];
}) {
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [snippetForId, setSnippetForId] = useState<string | null>(null);
  const readOnly = isDemo || isManager;

  // Quick stats up top.
  const total = rows.length;
  const working = rows.filter((r) => r.health === "working").length;
  const broken = rows.filter((r) => r.health === "broken").length;
  const primary = rows.find((r) => r.isPrimary && r.status === "ENABLED");

  return (
    <div className="mt-10">
      {/* Manager warning */}
      {isManager && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-800">
          This is a manager (MCC) account — conversion actions live on the
          sub-accounts under it, not here. Switch to a sub-account from
          /app/accounts to set up tracking.
        </p>
      )}

      {/* Success banner when bounced back from an OAuth callback. Reads
          ?crm=hubspot&connected=1 / ?ga4=connected from the URL. */}
      <ConnectSuccessBanner />

      {/* Connected sources strip — shows which CRMs + GA4 are linked at
          a glance, so the customer doesn't have to dig into the Add sheet
          to confirm. */}
      <ConnectedSourcesPanel accountId={accountId} />

      {/* Stats strip */}
      <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Total actions" value={total.toString()} />
        <StatTile label="Firing (7d)" value={working.toString()} tone={working > 0 ? "good" : "neutral"} />
        <StatTile label="Broken" value={broken.toString()} tone={broken > 0 ? "bad" : "neutral"} />
        <StatTile
          label="Primary goal"
          value={primary?.name ?? "—"}
          truncate
        />
      </section>

      {/* Add button */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold tracking-tight">
          All conversion actions
        </h2>
        {!readOnly && (
          <Button onClick={() => setCreateSheetOpen(true)}>
            <Plus />
            Add conversion
          </Button>
        )}
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <EmptyState onAdd={() => setCreateSheetOpen(true)} canAdd={!readOnly} />
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              accountId={accountId}
              readOnly={readOnly}
              onOpenSnippet={() => setSnippetForId(r.id)}
            />
          ))}
        </ul>
      )}

      {/* Create sheet */}
      {createSheetOpen && (
        <CreateSheet
          accountId={accountId}
          accountName={accountName}
          currencyCode={currencyCode}
          onClose={() => setCreateSheetOpen(false)}
        />
      )}

      {/* Snippet sheet */}
      {snippetForId && (
        <SnippetSheet
          conversionActionId={snippetForId}
          accountId={accountId}
          onClose={() => setSnippetForId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function Row({
  row,
  accountId,
  readOnly,
  onOpenSnippet,
}: {
  row: HubRow;
  accountId: string;
  readOnly: boolean;
  onOpenSnippet: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  function flipStatus(newStatus: "ENABLED" | "PAUSED") {
    setError(null);
    startTransition(async () => {
      const r = await setStatus(row.id, accountId, newStatus);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function runCheckFire() {
    setError(null);
    setCheckResult("Checking…");
    startTransition(async () => {
      const r = await checkFire(row.id, accountId);
      if (!r.ok) {
        setCheckResult(null);
        setError(r.error);
        return;
      }
      const lastTxt = r.lastFireAt
        ? new Date(r.lastFireAt).toLocaleDateString()
        : "never";
      setCheckResult(
        `${r.recentCount} fire${r.recentCount === 1 ? "" : "s"} in last 7d · last ${lastTxt}`,
      );
      router.refresh();
    });
  }

  function flipPrimary() {
    setError(null);
    startTransition(async () => {
      const r = await setPrimary(row.id, accountId, !row.isPrimary);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function flipTagInstalled() {
    setError(null);
    startTransition(async () => {
      const r = await markTagInstalled(row.id, accountId, !row.tagInstalled);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const canMutate = !readOnly && !pending;

  return (
    <li className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <HealthIcon status={row.health} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[14px] font-semibold">{row.name}</span>
              {row.isPrimary && <PrimaryBadge />}
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[row.category as ConversionCategory] ?? row.category}
              </span>
              <SourceBadge source={row.source} />
              <StatusBadge status={row.status} />
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {row.reason}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
              {row.providerConversionId && (
                <span>ID {row.providerConversionId}</span>
              )}
              {row.countingType && <span>{row.countingType}</span>}
              {row.valueUsd != null && row.valueUsd > 0 && (
                <span>${row.valueUsd.toFixed(2)} per fire</span>
              )}
              {row.lookbackDays != null && (
                <span>{row.lookbackDays}d lookback</span>
              )}
              {row.tagInstalled && (
                <span className="text-emerald-700">
                  <CheckCircle2 className="mr-0.5 inline size-3" />
                  tag installed
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSnippet}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium hover:bg-muted"
          >
            <Code2 className="size-3" />
            Snippet
          </button>
          {canMutate && row.providerConversionId && (
            <button
              type="button"
              onClick={runCheckFire}
              disabled={pending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium hover:bg-muted disabled:opacity-50"
              title="Ask Google right now whether this action has fired in the last 7 days."
            >
              {pending ? "…" : "Check status"}
            </button>
          )}
          {canMutate && (
            <>
              <button
                type="button"
                onClick={flipPrimary}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium",
                  row.isPrimary
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15"
                    : "border-border bg-background hover:bg-muted",
                )}
                title={
                  row.isPrimary
                    ? "Counts toward the Conversions column. Click to demote."
                    : "Promote to primary goal."
                }
              >
                {row.isPrimary ? (
                  <Star className="size-3 fill-current" />
                ) : (
                  <StarOff className="size-3" />
                )}
                {row.isPrimary ? "Primary" : "Make primary"}
              </button>
              {row.status === "ENABLED" && (
                <button
                  type="button"
                  onClick={() => flipStatus("PAUSED")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium hover:bg-muted"
                >
                  Pause
                </button>
              )}
              {row.status === "PAUSED" && (
                <button
                  type="button"
                  onClick={() => flipStatus("ENABLED")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[11.5px] font-medium text-white hover:bg-emerald-600/85"
                >
                  Enable
                </button>
              )}
              <button
                type="button"
                onClick={flipTagInstalled}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium",
                  row.tagInstalled
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15"
                    : "border-border bg-background hover:bg-muted",
                )}
                title={
                  row.tagInstalled
                    ? "You attested the snippet is on your site. Click to revoke."
                    : "Mark the snippet as installed. Lets Create-form unlock conversion-based bidding before the first fire arrives."
                }
              >
                <CheckCircle2 className="size-3" />
                {row.tagInstalled ? "Tag installed" : "Mark tag installed"}
              </button>
            </>
          )}
        </div>
      </div>
      {checkResult && !error && (
        <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 text-[11.5px] text-emerald-800">
          {checkResult}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd, canAdd }: { onAdd: () => void; canAdd: boolean }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
      <Tag className="mx-auto size-6 text-muted-foreground" />
      <h3 className="mt-3 text-[15px] font-semibold">
        No conversion actions yet
      </h3>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-muted-foreground">
        Until you add one, Google can&apos;t tell which clicks turned into
        leads. Bidding will be limited to Maximize Clicks.
      </p>
      {canAdd && (
        <Button className="mt-5" onClick={onAdd}>
          <Plus />
          Add your first conversion
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create sheet — pick source → fill fields → push to Google
// ---------------------------------------------------------------------------

function CreateSheet({
  accountId,
  accountName,
  currencyCode,
  onClose,
}: {
  accountId: string;
  accountName: string;
  currencyCode: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  type Step = "source" | "details-web" | "details-ga4" | "crm-connect" | "csv-upload";
  const [step, setStep] = useState<Step>("source");
  const [sourceId, setSourceId] = useState<SourceOption["id"] | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConversionCategory>("SUBMIT_LEAD_FORM");
  const [valueType, setValueType] = useState<"fixed" | "count-only">("count-only");
  const [valueAmount, setValueAmount] = useState<number>(0);
  const [countingType, setCountingType] = useState<"ONE_PER_CLICK" | "MANY_PER_CLICK">(
    "ONE_PER_CLICK",
  );
  const [isPrimary, setIsPrimary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // GA4-specific
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [ga4PropertyName, setGa4PropertyName] = useState("");
  const [ga4EventName, setGa4EventName] = useState("");
  const [ga4Kind, setGa4Kind] = useState<
    "custom" | "purchase" | "generate_lead" | "qualify_lead"
  >("custom");

  function pickSource(id: SourceOption["id"]) {
    const opt = SOURCE_OPTIONS.find((s) => s.id === id);
    if (!opt?.available) return;
    setSourceId(id);
    // Pre-fill sensible defaults per source + route to the right details step.
    if (id === "phone_call") {
      setCategory("PHONE_CALL_LEAD");
      setName("Phone call lead");
      setStep("details-web");
    } else if (id === "website_tag" || id === "google_tag_manager") {
      setCategory("SUBMIT_LEAD_FORM");
      setName("Lead form submit");
      setStep("details-web");
    } else if (id === "ga4_link") {
      setCategory("PURCHASE");
      setName("GA4 — purchase");
      setStep("details-ga4");
    } else if (id === "crm") {
      setStep("crm-connect");
    } else if (id === "offline_csv") {
      setStep("csv-upload");
    }
  }

  function submitGa4() {
    setError(null);
    startTransition(async () => {
      const res = await createGa4Conversion({
        accountId,
        name: name.trim(),
        category,
        ga4PropertyId: ga4PropertyId.trim(),
        ga4PropertyName: ga4PropertyName.trim(),
        ga4EventName: ga4EventName.trim(),
        ga4Kind,
        countingType,
        isPrimary,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreatedId(res.conversionActionId);
      router.refresh();
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createConversionAction({
        accountId,
        name: name.trim(),
        category,
        valueType,
        valueAmount: valueType === "fixed" ? valueAmount : undefined,
        countingType,
        isPrimary,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreatedId(res.conversionActionId);
      router.refresh();
    });
  }

  // Confirmation panel after success — show next step (snippet).
  if (createdId) {
    return (
      <SheetShell title="Conversion action created" onClose={onClose}>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-800">
            <CheckCircle2 className="size-4" />
            Created in Google Ads
          </div>
          <p className="mt-1 text-[12px] text-emerald-700">
            <strong>{name}</strong> is now a tracked conversion on{" "}
            <strong>{accountName}</strong>. Next: install the snippet on your
            site so it can fire.
          </p>
        </div>
        <p className="mt-4 text-[12.5px] text-muted-foreground">
          Click <strong>Snippet</strong> on the row that just appeared to copy
          the gtag base tag + event tag.
        </p>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </SheetShell>
    );
  }

  if (step === "source") {
    return (
      <SheetShell title="Add a conversion source" onClose={onClose}>
        <p className="text-[12.5px] text-muted-foreground">
          Where does this conversion happen? Pick the source — we&apos;ll set
          everything up. New options unlock as we add them.
        </p>
        <div className="mt-5 grid gap-2">
          {SOURCE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => pickSource(opt.id)}
                disabled={!opt.available}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  opt.available
                    ? "border-border bg-background hover:bg-muted"
                    : "border-border bg-muted/40 opacity-60",
                )}
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded bg-foreground/5">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                    {opt.label}
                    {!opt.available && (
                      <span className="rounded border border-border bg-muted px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        soon
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {opt.helper}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SheetShell>
    );
  }

  // step === "csv-upload" — show the CSV upload form
  if (step === "csv-upload") {
    return (
      <CsvUploadSheet
        accountId={accountId}
        currencyCode={currencyCode}
        onClose={onClose}
        onBack={() => setStep("source")}
      />
    );
  }

  // step === "crm-connect" — pick CRM + bind action + show webhook URL
  if (step === "crm-connect") {
    return (
      <CrmConnectSheet
        accountId={accountId}
        onClose={onClose}
        onBack={() => setStep("source")}
      />
    );
  }

  // step === "details-ga4" — GA4-specific form (with OAuth-driven
  // property/event pickers when connected).
  if (step === "details-ga4") {
    return (
      <SheetShell
        title="Link a GA4 event"
        onClose={onClose}
        onBack={() => setStep("source")}
      >
        <div className="grid gap-5">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-3 text-[11.5px] text-amber-800">
            <strong>Before this works:</strong> in Google Ads → Tools →
            Linked accounts, link this Google Ads account to your GA4
            property. Then come back here.
          </div>

          <Ga4PropertyEventPicker
            accountId={accountId}
            propertyId={ga4PropertyId}
            propertyName={ga4PropertyName}
            eventName={ga4EventName}
            onPick={({ propertyId, propertyName, eventName }) => {
              setGa4PropertyId(propertyId);
              setGa4PropertyName(propertyName);
              setGa4EventName(eventName);
              // Pre-fill name + ga4Kind based on event
              if (!name || name === "GA4 — purchase") {
                setName(`GA4 — ${eventName}`);
              }
              if (eventName === "purchase") setGa4Kind("purchase");
              else if (eventName === "generate_lead") setGa4Kind("generate_lead");
              else if (eventName === "qualify_lead") setGa4Kind("qualify_lead");
              else setGa4Kind("custom");
            }}
          />

          <div className="grid gap-1.5">
            <Label className="text-[12px] font-medium">
              Conversion action name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. GA4 — purchase"
            />
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-medium">GA4 property ID</Label>
              <Input
                value={ga4PropertyId}
                onChange={(e) => setGa4PropertyId(e.target.value)}
                placeholder="e.g. 312345678"
              />
              <p className="text-[10.5px] text-muted-foreground">
                Auto-filled when you pick a property above. Else enter
                manually — the number in{" "}
                <code className="font-mono">properties/&#123;id&#125;</code> URLs.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-medium">GA4 property name</Label>
              <Input
                value={ga4PropertyName}
                onChange={(e) => setGa4PropertyName(e.target.value)}
                placeholder="e.g. Main Site — production"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-[12px] font-medium">GA4 event name</Label>
            <Input
              value={ga4EventName}
              onChange={(e) => setGa4EventName(e.target.value)}
              placeholder="e.g. purchase, generate_lead, custom_event"
            />
            <p className="text-[10.5px] text-muted-foreground">
              Must match exactly the event configured as a key event in
              GA4.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-[12px] font-medium">Type</Label>
            <select
              value={ga4Kind}
              onChange={(e) =>
                setGa4Kind(
                  e.target.value as
                    | "custom"
                    | "purchase"
                    | "generate_lead"
                    | "qualify_lead",
                )
              }
              className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
            >
              <option value="custom">Custom event</option>
              <option value="purchase">Purchase</option>
              <option value="generate_lead">Generate lead</option>
              <option value="qualify_lead">Qualify lead</option>
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-[12px] font-medium">Category</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ConversionCategory)}
              className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
            >
              {CREATABLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="mt-0.5 size-3.5 accent-foreground"
            />
            <span>
              <span className="font-medium">Count this as a primary goal</span>
            </span>
          </label>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              Creates in Google Ads with GA4 settings attached.
            </span>
            <Button
              onClick={submitGa4}
              disabled={
                pending ||
                !name.trim() ||
                !ga4PropertyId.trim() ||
                !ga4EventName.trim()
              }
            >
              {pending ? "Creating…" : "Create GA4 conversion"}
            </Button>
          </div>
        </div>
      </SheetShell>
    );
  }

  // step === "details-web" — website tag / GTM / phone-call form
  // (phone_call uses this with category=PHONE_CALL_LEAD pre-filled
  // and an extra helper note about Google's call-tracking number).
  return (
    <SheetShell
      title={
        sourceId === "phone_call"
          ? "Phone call conversion"
          : "Conversion details"
      }
      onClose={onClose}
      onBack={() => setStep("source")}
    >
      {sourceId === "phone_call" && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-3 text-[11.5px] text-amber-800">
          Google will swap your phone number on call-only ads with a
          Google-provided forwarding number. Configure the forwarding
          number under Google Ads → Tools → Conversions after this
          action is created.
        </div>
      )}
      <div className="grid gap-5">
        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Order completed"
          />
          <p className="text-[11px] text-muted-foreground">
            Visible in Google Ads and our reports. Use plain language.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">Category</Label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ConversionCategory)}
            className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
          >
            {CREATABLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Google uses this to group similar goals and inform bidding.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">Value</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setValueType("count-only")}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-[12px]",
                valueType === "count-only"
                  ? "border-foreground bg-foreground/[0.04]"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <div className="font-semibold">Count only</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Each fire = 1. Pick this for leads when value is unknown.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setValueType("fixed")}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-[12px]",
                valueType === "fixed"
                  ? "border-foreground bg-foreground/[0.04]"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <div className="font-semibold">Fixed amount</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Same value every fire — good for known-price products.
              </div>
            </button>
          </div>
          {valueType === "fixed" && (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {currencyCode}
              </span>
              <Input
                type="number"
                value={valueAmount}
                onChange={(e) => setValueAmount(Number(e.target.value))}
                min={0}
                step={0.01}
                className="h-9 w-32"
              />
            </div>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">Counting</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setCountingType("ONE_PER_CLICK")}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-[12px]",
                countingType === "ONE_PER_CLICK"
                  ? "border-foreground bg-foreground/[0.04]"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <div className="font-semibold">One per click</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Best for leads / signups — same person submitting twice = 1.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setCountingType("MANY_PER_CLICK")}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-[12px]",
                countingType === "MANY_PER_CLICK"
                  ? "border-foreground bg-foreground/[0.04]"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <div className="font-semibold">Many per click</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Best for purchases — every checkout counts even if same user.
              </div>
            </button>
          </div>
        </div>

        <label className="flex items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="mt-0.5 size-3.5 accent-foreground"
          />
          <span>
            <span className="font-medium">Count this as a primary goal</span>
            <span className="ml-1 text-muted-foreground">
              — counts toward the &quot;Conversions&quot; column and is what
              smart bidding optimizes for.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">
            Creates in Google Ads + mirrors here.
          </span>
          <Button
            onClick={submit}
            disabled={pending || !name.trim()}
          >
            {pending ? "Creating…" : "Create conversion"}
          </Button>
        </div>
      </div>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// Snippet sheet — gtag base + event + no-script + GTM
// ---------------------------------------------------------------------------

function SnippetSheet({
  conversionActionId,
  accountId,
  onClose,
}: {
  conversionActionId: string;
  accountId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [snippets, setSnippets] = useState<Awaited<
    ReturnType<typeof getSnippets>
  > | null>(null);
  const [tab, setTab] = useState<"gtag" | "gtm">("gtag");

  // Lazy fetch on mount.
  useEffect(() => {
    startTransition(async () => {
      const r = await getSnippets(conversionActionId);
      setSnippets(r);
    });
  }, [conversionActionId]);

  function markInstalled() {
    startTransition(async () => {
      await markTagInstalled(conversionActionId, accountId, true);
      router.refresh();
      onClose();
    });
  }

  return (
    <SheetShell title="Install the tag" onClose={onClose}>
      {!snippets && (
        <p className="text-[12.5px] text-muted-foreground">Loading…</p>
      )}
      {snippets && !snippets.ok && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          {snippets.error}
        </p>
      )}
      {snippets && snippets.ok && (
        <div className="grid gap-4">
          <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setTab("gtag")}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                tab === "gtag"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              Website tag (gtag.js)
            </button>
            <button
              type="button"
              onClick={() => setTab("gtm")}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                tab === "gtm"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              Google Tag Manager
            </button>
          </div>

          {tab === "gtag" && (
            <>
              <CodeBlock
                label="① Base tag — put this in <head> of every page"
                code={snippets.snippets.baseTag}
              />
              <CodeBlock
                label="② Event tag — fire on the conversion page"
                code={snippets.snippets.eventTag}
              />
              <details className="rounded-md border border-border bg-card p-3 text-[12px]">
                <summary className="cursor-pointer font-medium">
                  No-script fallback (rarely needed)
                </summary>
                <div className="mt-3">
                  <CodeBlock
                    label=""
                    code={snippets.snippets.noScriptImg}
                  />
                </div>
              </details>
            </>
          )}

          {tab === "gtm" && (
            <CodeBlock
              label="Paste these values into a new “Google Ads Conversion Tracking” tag in GTM"
              code={snippets.snippets.gtmTrigger}
            />
          )}

          {snippets.fromGoogle ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] p-3 text-[12px]">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 text-emerald-700" />
                <div>
                  <div className="font-medium text-emerald-900">
                    Snippets pulled from Google
                  </div>
                  <p className="mt-0.5 text-emerald-800">
                    Conversion label is already substituted — paste these
                    as-is into your site or GTM container.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-3 text-[12px]">
              <div className="flex items-start gap-2">
                <HelpCircle className="mt-0.5 size-3.5 text-amber-700" />
                <div>
                  <div className="font-medium text-amber-900">
                    Using the placeholder
                  </div>
                  <p className="mt-0.5 text-amber-800">
                    Google hasn&apos;t generated a website snippet yet (this
                    is a GA4-linked or call action, or it was just created).
                    Fetch the per-action label from{" "}
                    <em>Google Ads → Goals → Tag setup → Manual install</em>{" "}
                    and swap the{" "}
                    <code className="font-mono">YOUR_CONVERSION_LABEL</code>{" "}
                    placeholder above.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              When the snippet is live on your site, mark it installed so
              bidding can unlock.
            </span>
            <Button onClick={markInstalled} disabled={pending}>
              <ShieldCheck />
              Mark tag installed
            </Button>
          </div>
        </div>
      )}
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function SheetShell({
  title,
  onClose,
  onBack,
  children,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            )}
            <h3 className="text-[14px] font-semibold tracking-tight">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div>
      {label && (
        <div className="mb-1.5 text-[11.5px] font-medium text-muted-foreground">
          {label}
        </div>
      )}
      <div className="relative rounded-md border border-border bg-muted/40">
        <pre className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-5">
          {code}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[10.5px] font-medium hover:bg-muted"
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  truncate,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
  truncate?: boolean;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-[14px] font-medium",
          truncate && "truncate",
          toneClass,
        )}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function HealthIcon({ status }: { status: ConversionHealthStatus }) {
  const map = {
    working: {
      bg: "bg-emerald-500/15 text-emerald-700",
      icon: <CheckCircle2 className="size-4" />,
    },
    stale: {
      bg: "bg-amber-500/15 text-amber-700",
      icon: <Clock className="size-4" />,
    },
    broken: {
      bg: "bg-destructive/15 text-destructive",
      icon: <XCircle className="size-4" />,
    },
    inactive: {
      bg: "bg-muted text-muted-foreground",
      icon: <HelpCircle className="size-4" />,
    },
  } as const;
  const c = map[status];
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md",
        c.bg,
      )}
    >
      {c.icon}
    </span>
  );
}

function SourceBadge({ source }: { source: "created" | "imported" }) {
  return (
    <span
      className="rounded border border-border bg-muted/40 px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
      title={
        source === "created"
          ? "Created from inside Adsense"
          : "Mirrored from Google during account import"
      }
    >
      {source}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    ENABLED: {
      bg: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700",
      label: "Live",
    },
    PAUSED: {
      bg: "border-amber-500/30 bg-amber-500/[0.08] text-amber-700",
      label: "Paused",
    },
    REMOVED: {
      bg: "border-muted bg-muted text-muted-foreground",
      label: "Removed",
    },
  };
  const c = map[status] ?? { bg: "border-border bg-muted", label: status };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider",
        c.bg,
      )}
    >
      {c.label}
    </span>
  );
}

function PrimaryBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-800">
      <Star className="size-2.5 fill-current" />
      primary
    </span>
  );
}

// ---------------------------------------------------------------------------
// CRM connect sheet — Phase B6
//
// Three CRM sources (HubSpot / Pipedrive / Zoho). For each, we show:
//   - the webhook URL the customer pastes into their CRM's webhook config
//   - the per-account secret the customer pastes into the
//     `X-Adsense-Webhook-Secret` header field
//   - a picker to bind which existing ConversionAction this CRM feeds
//     (the customer creates the action via the website-tag flow first;
//      the CRM source just uploads OFFLINE fires against that action)
//   - "Rotate secret" + fire counter + last-fire timestamp
//
// We do NOT do CRM OAuth in this turn — the customer manually pastes
// the URL+secret into HubSpot/Pipedrive/Zoho's native webhook UI.
// Full OAuth integrations land in their own follow-up phases.
// ---------------------------------------------------------------------------

function CrmConnectSheet({
  accountId,
  onClose,
  onBack,
}: {
  accountId: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [source, setSource] = useState<CrmSource>("hubspot");
  const [config, setConfig] = useState<CrmConfigState | null>(null);
  const [actions, setActions] = useState<HubActionLite[]>([]);
  const [pickActionId, setPickActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the current config + the account's actions on mount + when
  // the user switches source.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cfg, acts] = await Promise.all([
        getCrmConfig(accountId, source),
        loadActionsLite(accountId),
      ]);
      if (cancelled) return;
      if (cfg.ok) {
        setConfig(cfg.config);
        setPickActionId(cfg.config.conversionActionId);
      } else {
        setError(cfg.error);
      }
      setActions(acts);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, source]);

  function rotate() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await rotateCrmSecret(accountId, source);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConfig((c) => (c ? { ...c, secret: r.secret } : c));
      setNotice("Secret rotated. Update it in your CRM webhook config.");
    });
  }

  function bind() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await bindCrmFeedAction(accountId, source, pickActionId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(
        pickActionId
          ? "Bound. Webhook fires will now upload against this conversion action."
          : "Unbound. Webhook fires will be rejected until you bind an action.",
      );
      router.refresh();
    });
  }

  return (
    <SheetShell title="Connect a CRM" onClose={onClose} onBack={onBack}>
      <div className="grid gap-5">
        {/* Source tabs */}
        <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11.5px]">
          {(["hubspot", "pipedrive", "zoho"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={cn(
                "rounded px-2.5 py-1 font-medium capitalize transition-colors",
                source === s
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* OAuth panel — full-fat option: poll the CRM via OAuth instead
            of waiting for the customer to set up outbound webhooks. */}
        <CrmOAuthPanel accountId={accountId} provider={source} actions={actions} />

        <div className="my-2 flex items-center gap-3 text-[10.5px] uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>or — manual webhook</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <p className="text-[12.5px] text-muted-foreground">
          If you can&apos;t use OAuth (no admin rights, etc.), configure{" "}
          {source.charAt(0).toUpperCase() + source.slice(1)} to POST to the
          webhook URL below when a deal becomes qualified. We&apos;ll batch-
          upload those fires to Google every 15 minutes.
        </p>

        {/* Webhook URL */}
        {config && (
          <>
            <CodeField
              label="Webhook URL"
              value={config.webhookUrl ?? ""}
              helper="Paste this into your CRM's webhook destination."
            />
            <CodeField
              label="X-Adsense-Webhook-Secret"
              value={config.secret ?? ""}
              helper="Required header. Without it, your webhook will be rejected."
              afterButton={
                <button
                  type="button"
                  onClick={rotate}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[10.5px] font-medium hover:bg-muted disabled:opacity-50"
                >
                  <RefreshCw className="size-3" />
                  Rotate
                </button>
              }
            />
          </>
        )}

        {/* Body schema */}
        <details className="rounded-md border border-border bg-card p-3 text-[12px]">
          <summary className="cursor-pointer font-medium">
            Expected JSON body shape
          </summary>
          <pre className="mt-3 overflow-auto rounded bg-muted/30 p-3 font-mono text-[10.5px] leading-5">
{`{
  "gclid": "EAIaIQobChMI...",          // or gbraid / wbraid
  "conversion_date_time": "2026-06-20T18:30:00Z",
  "value": 350.00,                     // optional, USD by default
  "currency": "USD",                   // optional
  "external_id": "deal-12345",         // optional, for dedupe
  "order_id": "ORDER-9876",            // optional
  "conversion_action_id": "..."        // optional override; defaults
                                       //  to the action bound below
}`}
          </pre>
        </details>

        {/* Bind a conversion action */}
        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">
            Default conversion action for this CRM
          </Label>
          {actions.length === 0 ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11.5px] text-amber-800">
              No conversion actions yet. Create one via the &quot;Website
              tag&quot; flow first — CRM fires upload against an existing
              action, not into nothing.
            </p>
          ) : (
            <select
              value={pickActionId ?? ""}
              onChange={(e) => setPickActionId(e.target.value || null)}
              className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
            >
              <option value="">— Pick one —</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.isPrimary ? "(primary)" : ""}
                </option>
              ))}
            </select>
          )}
          <p className="text-[10.5px] text-muted-foreground">
            All CRM fires upload against this action unless the webhook
            body specifies a different <code className="font-mono">conversion_action_id</code>.
          </p>
        </div>

        {/* Stats */}
        {config && (
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Fires received" value={config.fireCount.toString()} />
            <StatTile
              label="Last fire"
              value={
                config.lastFireAt
                  ? new Date(config.lastFireAt).toLocaleString()
                  : "—"
              }
              truncate
            />
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 text-[11.5px] text-emerald-800">
            {notice}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button onClick={bind} disabled={pending || actions.length === 0}>
            <ShieldCheck />
            {pending ? "Saving…" : "Bind to this action"}
          </Button>
        </div>
      </div>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// CSV upload sheet — Phase B8
//
// Customer pastes a CSV (gclid, conversion_date_time, value?, currency?,
// order_id?, external_id?) into a textarea. We parse + enqueue to
// PendingOfflineConversion; the 15-min cron uploads to Google.
// ---------------------------------------------------------------------------

function CsvUploadSheet({
  accountId,
  currencyCode,
  onClose,
  onBack,
}: {
  accountId: string;
  currencyCode: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actions, setActions] = useState<HubActionLite[]>([]);
  const [pickActionId, setPickActionId] = useState<string | null>(null);
  const [csv, setCsv] = useState<string>(
    "gclid,conversion_date_time,value,currency,order_id,external_id\n",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    enqueued: number;
    deduped: number;
    errors: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const acts = await loadActionsLite(accountId);
      if (cancelled) return;
      setActions(acts);
      if (acts[0]) setPickActionId(acts[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function submit() {
    setError(null);
    setResult(null);
    if (!pickActionId) {
      setError("Pick a conversion action to upload against.");
      return;
    }
    const parsed = parseCsv(csv);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.rows.length === 0) {
      setError("CSV has no data rows.");
      return;
    }
    startTransition(async () => {
      const r = await uploadCsvConversions({
        accountId,
        conversionActionId: pickActionId,
        rows: parsed.rows,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({
        enqueued: r.enqueued,
        deduped: r.deduped,
        errors: r.errors.length,
      });
      router.refresh();
    });
  }

  return (
    <SheetShell title="Upload offline conversions (CSV)" onClose={onClose} onBack={onBack}>
      <div className="grid gap-5">
        <p className="text-[12.5px] text-muted-foreground">
          Paste a CSV with one row per conversion. Header row required.
          Columns: <code className="font-mono">gclid</code> (or{" "}
          <code className="font-mono">gbraid</code>/<code className="font-mono">wbraid</code>),{" "}
          <code className="font-mono">conversion_date_time</code> (ISO-8601 UTC),
          optional{" "}
          <code className="font-mono">value</code>,{" "}
          <code className="font-mono">currency</code> (defaults to {currencyCode}),{" "}
          <code className="font-mono">order_id</code>,{" "}
          <code className="font-mono">external_id</code> (for dedupe).
        </p>

        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">
            Upload against which conversion action?
          </Label>
          {actions.length === 0 ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11.5px] text-amber-800">
              No conversion actions yet. Create one first.
            </p>
          ) : (
            <select
              value={pickActionId ?? ""}
              onChange={(e) => setPickActionId(e.target.value || null)}
              className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
            >
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.isPrimary ? "(primary)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label className="text-[12px] font-medium">CSV</Label>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-[11.5px] leading-5"
            placeholder={`gclid,conversion_date_time,value,currency,order_id,external_id\nEAIaIQob...,2026-06-20T12:34:56Z,350,USD,ORDER-1,deal-123`}
          />
          <p className="text-[10.5px] text-muted-foreground">
            Capped at 5000 rows per upload. Larger sets: split into batches.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
            {error}
          </p>
        )}

        {result && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 text-[12px] text-emerald-800">
            Queued <strong>{result.enqueued}</strong> for upload (
            {result.deduped} were dedupes against earlier rows). {result.errors}{" "}
            row errors. The cron uploads to Google within 15 minutes.
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={submit}
            disabled={pending || actions.length === 0 || !pickActionId}
          >
            {pending ? "Uploading…" : "Queue for upload"}
          </Button>
        </div>
      </div>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// Helpers for the CRM/CSV sheets — load actions, parse CSV, copyable codefield
// ---------------------------------------------------------------------------

type HubActionLite = { id: string; name: string; isPrimary: boolean };

async function loadActionsLite(accountId: string): Promise<HubActionLite[]> {
  // We reuse the server action from /app/create that already exists.
  const { listConversionActionsForAccount } = await import(
    "../../../create/actions"
  );
  const rows = await listConversionActionsForAccount(accountId);
  return rows
    .filter((r) => r.status === "ENABLED")
    .map((r) => ({ id: r.id, name: r.name, isPrimary: r.isPrimary }));
}

function parseCsv(
  text: string,
):
  | {
      ok: true;
      rows: Array<{
        gclid?: string;
        gbraid?: string;
        wbraid?: string;
        conversionDateTime: string;
        value?: number;
        currency?: string;
        orderId?: string;
        externalId?: string;
      }>;
    }
  | { ok: false; error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: true, rows: [] };
  const header = lines[0]!.split(",").map((s) => s.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iGclid = idx("gclid");
  const iGbraid = idx("gbraid");
  const iWbraid = idx("wbraid");
  const iDate = idx("conversion_date_time");
  const iValue = idx("value");
  const iCurrency = idx("currency");
  const iOrder = idx("order_id");
  const iExternal = idx("external_id");
  if (iDate < 0) {
    return {
      ok: false,
      error: "Missing required header `conversion_date_time`.",
    };
  }
  if (iGclid < 0 && iGbraid < 0 && iWbraid < 0) {
    return {
      ok: false,
      error: "Header must include at least one of gclid / gbraid / wbraid.",
    };
  }
  const rows = [] as Array<{
    gclid?: string;
    gbraid?: string;
    wbraid?: string;
    conversionDateTime: string;
    value?: number;
    currency?: string;
    orderId?: string;
    externalId?: string;
  }>;
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i]!.split(",").map((s) => s.trim());
    const date = cells[iDate];
    if (!date) continue;
    const valueStr = iValue >= 0 ? cells[iValue] : undefined;
    rows.push({
      gclid: iGclid >= 0 ? cells[iGclid] || undefined : undefined,
      gbraid: iGbraid >= 0 ? cells[iGbraid] || undefined : undefined,
      wbraid: iWbraid >= 0 ? cells[iWbraid] || undefined : undefined,
      conversionDateTime: date,
      value: valueStr ? Number(valueStr) : undefined,
      currency: iCurrency >= 0 ? cells[iCurrency] || undefined : undefined,
      orderId: iOrder >= 0 ? cells[iOrder] || undefined : undefined,
      externalId: iExternal >= 0 ? cells[iExternal] || undefined : undefined,
    });
  }
  return { ok: true, rows };
}

function CodeField({
  label,
  value,
  helper,
  afterButton,
}: {
  label: string;
  value: string;
  helper?: string;
  afterButton?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="block w-full overflow-x-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px]">
          {value || "—"}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        {afterButton}
      </div>
      {helper && (
        <p className="text-[10.5px] text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CRM OAuth panel — Phase B6.1
//
// Lives at the top of CrmConnectSheet. Shows:
//   - "Connect <provider>" button (deep-links to /api/crm/oauth/[p]/start)
//     when not yet connected
//   - When connected: load pipelines, render stage→action mapping rows,
//     "Poll now" + "Disconnect" + last-poll status
//
// Pipelines are loaded lazily on connect — saves an API round-trip when
// the user is browsing CRMs.
// ---------------------------------------------------------------------------

function CrmOAuthPanel({
  accountId,
  provider,
  actions,
}: {
  accountId: string;
  provider: CrmSource;
  actions: HubActionLite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CrmOAuthState | null>(null);
  const [pipelines, setPipelines] = useState<NormalizedPipeline[]>([]);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load OAuth state on mount + when provider changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPipelines([]);
      setRules({});
      setPipelineError(null);
      const r = await getCrmOAuthState(accountId, provider);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setState(r.state);
      setRules(r.state.stageRules);
      if (r.state.connected) {
        const p = await listCrmPipelines(accountId, provider);
        if (cancelled) return;
        if (p.ok) setPipelines(p.pipelines);
        else setPipelineError(p.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, provider]);

  function connect() {
    if (!state) return;
    // Full-page redirect so the OAuth callback returns to a fresh
    // render (we can't open the consent screen in an embedded iframe).
    window.location.href = state.startUrl;
  }

  function disconnect() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await disconnectCrmOauth(accountId, provider);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setState((s) => (s ? { ...s, connected: false, connectionId: null } : s));
      setPipelines([]);
      setRules({});
      setNotice("Disconnected. Tokens removed from our DB.");
      router.refresh();
    });
  }

  function pollNow() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await pollCrmNow(accountId, provider);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(
        `Scanned ${r.dealsScanned} deals · ${r.matched} matched rules · ${r.enqueued} enqueued.`,
      );
      router.refresh();
    });
  }

  function setRule(stageId: string, actionId: string | null) {
    setRules((prev) => {
      const next = { ...prev };
      if (actionId) next[stageId] = actionId;
      else delete next[stageId];
      return next;
    });
  }

  function saveRules() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await saveStageRules(accountId, provider, rules);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice("Stage rules saved.");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] font-semibold">
          OAuth — recommended
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider",
            state?.connected
              ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700"
              : "border-muted bg-muted text-muted-foreground",
          )}
        >
          {state?.connected ? "connected" : "not connected"}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Connect once, we poll your CRM every 15 minutes for deals that
        moved into a stage you map below.
      </p>

      {!state?.connected && (
        <div className="mt-3">
          <Button onClick={connect}>
            <ShieldCheck />
            Connect {provider}
          </Button>
        </div>
      )}

      {state?.connected && (
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                Last poll
              </div>
              <div className="mt-0.5">
                {state.lastPolledAt
                  ? new Date(state.lastPolledAt).toLocaleString()
                  : "never"}
              </div>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                Last deal watermark
              </div>
              <div className="mt-0.5">
                {state.lastDealUpdatedAt
                  ? new Date(state.lastDealUpdatedAt).toLocaleString()
                  : "—"}
              </div>
            </div>
          </div>

          {state.lastPollError && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-800">
              Last poll error: {state.lastPollError}
            </p>
          )}

          {/* Stage → conversion action mapping */}
          <div className="grid gap-2">
            <Label className="text-[11.5px] font-medium">
              Stage → conversion action map
            </Label>
            {pipelineError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-[11px] text-destructive">
                {pipelineError}
              </p>
            )}
            {pipelines.length === 0 && !pipelineError && (
              <p className="text-[11px] text-muted-foreground">
                Loading pipelines from {provider}…
              </p>
            )}
            {pipelines.map((p) => (
              <details
                key={p.id}
                open
                className="rounded-md border border-border bg-card p-3"
              >
                <summary className="cursor-pointer text-[12px] font-medium">
                  {p.name}
                </summary>
                <div className="mt-3 grid gap-2">
                  {p.stages.map((st) => (
                    <div
                      key={st.id}
                      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
                    >
                      <div className="truncate text-[11.5px]">{st.name}</div>
                      <span className="text-muted-foreground">→</span>
                      <select
                        value={rules[st.id] ?? ""}
                        onChange={(e) => setRule(st.id, e.target.value || null)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-[11.5px]"
                      >
                        <option value="">— Ignore —</option>
                        {actions.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 text-[11px] text-emerald-800">
              {notice}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button onClick={saveRules} disabled={pending}>
              {pending ? "Saving…" : "Save rules"}
            </Button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={pollNow}
                disabled={pending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className="size-3" />
                Poll now
              </button>
              <button
                type="button"
                onClick={disconnect}
                disabled={pending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 text-[11.5px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ga4PropertyEventPicker — Phase B5.1
//
// Lives at the top of the GA4 details sheet. If the user has connected
// GA4 via OAuth, we list accessible properties + their key events and
// let them click to pre-fill the form. Otherwise show a "Connect GA4"
// button.
// ---------------------------------------------------------------------------

function Ga4PropertyEventPicker({
  accountId,
  propertyId,
  propertyName,
  eventName,
  onPick,
}: {
  accountId: string;
  propertyId: string;
  propertyName: string;
  eventName: string;
  onPick: (v: {
    propertyId: string;
    propertyName: string;
    eventName: string;
  }) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<Ga4ConnectionState | null>(null);
  const [properties, setProperties] = useState<Ga4Property[] | null>(null);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [events, setEvents] = useState<Ga4KeyEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getGa4ConnectionState(accountId);
      if (cancelled) return;
      if (!r.ok) return;
      setState(r.state);
      if (r.state.connected) {
        const p = await listGa4Properties(accountId);
        if (cancelled) return;
        if (p.ok) setProperties(p.properties);
        else setPropertiesError(p.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // When a property is picked, load its key events. All setState calls
  // live inside the async chain to satisfy React 19's set-state-in-effect
  // lint rule (no sync setState in effect body).
  useEffect(() => {
    let cancelled = false;
    const empty = !propertyId || !state?.connected;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (empty) {
        setEvents(null);
        return;
      }
      setEventsLoading(true);
      setEventsError(null);
    });
    if (empty) {
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const r = await listGa4KeyEvents(accountId, propertyId);
      if (cancelled) return;
      setEventsLoading(false);
      if (r.ok) setEvents(r.events);
      else setEventsError(r.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, propertyId, state?.connected]);

  function connect() {
    if (!state) return;
    window.location.href = state.startUrl;
  }

  function disconnect() {
    startTransition(async () => {
      await disconnectGa4(accountId);
      setState((s) => (s ? { ...s, connected: false, oauthEmail: null } : s));
      setProperties(null);
      setEvents(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] font-semibold">
          GA4 picker {state?.connected && state.oauthEmail
            ? <span className="ml-2 font-mono text-[10.5px] font-normal text-muted-foreground">{state.oauthEmail}</span>
            : null}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider",
            state?.connected
              ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700"
              : "border-muted bg-muted text-muted-foreground",
          )}
        >
          {state?.connected ? "connected" : "not connected"}
        </span>
      </div>

      {!state?.connected && (
        <>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Connect to auto-fill the property ID + event name from your
            GA4 accessible properties. Otherwise fill the fields below
            manually.
          </p>
          <div className="mt-3">
            <Button onClick={connect}>
              <ShieldCheck />
              Connect GA4 (read-only)
            </Button>
          </div>
        </>
      )}

      {state?.connected && (
        <div className="mt-3 grid gap-3">
          {propertiesError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-[11px] text-destructive">
              {propertiesError}
            </p>
          )}
          {properties && properties.length === 0 && !propertiesError && (
            <p className="text-[11.5px] text-muted-foreground">
              No GA4 properties accessible to this OAuth user.
            </p>
          )}
          {properties && properties.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-[11.5px] font-medium">Property</Label>
              <select
                value={propertyId}
                onChange={(e) => {
                  const next = properties.find(
                    (p) => p.propertyId === e.target.value,
                  );
                  if (next) {
                    onPick({
                      propertyId: next.propertyId,
                      propertyName: next.displayName,
                      eventName: "",
                    });
                  } else {
                    onPick({
                      propertyId: "",
                      propertyName: "",
                      eventName: "",
                    });
                  }
                }}
                className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
              >
                <option value="">— Pick a property —</option>
                {properties.map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>
                    {p.accountName} · {p.displayName} ({p.propertyId})
                  </option>
                ))}
              </select>
            </div>
          )}

          {propertyId && (
            <div className="grid gap-1.5">
              <Label className="text-[11.5px] font-medium">Key event</Label>
              {eventsLoading && (
                <p className="text-[11px] text-muted-foreground">
                  Loading events…
                </p>
              )}
              {eventsError && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-800">
                  {eventsError}
                </p>
              )}
              {events && events.length === 0 && !eventsLoading && (
                <p className="text-[11.5px] text-muted-foreground">
                  No key events on this property. Mark events as key in
                  GA4 first.
                </p>
              )}
              {events && events.length > 0 && (
                <select
                  value={eventName}
                  onChange={(e) =>
                    onPick({
                      propertyId,
                      propertyName,
                      eventName: e.target.value,
                    })
                  }
                  className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
                >
                  <option value="">— Pick a key event —</option>
                  {events.map((ev) => (
                    <option key={ev.resourceName} value={ev.eventName}>
                      {ev.eventName} ({ev.countingMethod})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={disconnect}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
            >
              Disconnect GA4
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectSuccessBanner — reads ?crm=hubspot&connected=1 / ?ga4=connected
// from the URL (set by our OAuth callback routes) and shows a green
// success banner. Strips the params after first display so a refresh
// doesn't re-show it.
// ---------------------------------------------------------------------------

function ConnectSuccessBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const crm = params.get("crm");
    const crmConnected = params.get("connected") === "1";
    const ga4Connected = params.get("ga4") === "connected";
    let msg: string | null = null;
    if (crm && crmConnected) {
      msg = `${capitalize(crm)} connected. Map pipeline stages → conversion actions below to start counting offline conversions.`;
    } else if (ga4Connected) {
      msg = "GA4 connected. Pick properties + key events from a dropdown when adding GA4-based conversion actions.";
    }
    if (msg) {
      setMessage(msg);
      router.replace(pathname, { scroll: false });
    }
  }, [params, pathname, router]);

  if (!message) return null;
  return (
    <div className="mt-4 flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-emerald-900">Connected</div>
        <p className="mt-0.5 text-[12px] text-emerald-800">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => setMessage(null)}
        className="text-[11px] text-emerald-800 hover:text-emerald-900"
      >
        Dismiss
      </button>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// ConnectedSourcesPanel — single row showing GA4 + 3 CRMs and whether
// each is connected. Click a tile to jump straight to its config in the
// Add sheet (deferred; for now it's a static read-only summary). Renders
// nothing until state loads.
// ---------------------------------------------------------------------------

type SourceTile = {
  key: "ga4" | "hubspot" | "pipedrive" | "zoho";
  label: string;
  connected: boolean;
  detail: string;
};

function ConnectedSourcesPanel({ accountId }: { accountId: string }) {
  const [tiles, setTiles] = useState<SourceTile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ga4, hub, pipe, zoho] = await Promise.all([
        getGa4ConnectionState(accountId),
        getCrmOAuthState(accountId, "hubspot"),
        getCrmOAuthState(accountId, "pipedrive"),
        getCrmOAuthState(accountId, "zoho"),
      ]);
      if (cancelled) return;
      const next: SourceTile[] = [
        {
          key: "ga4",
          label: "GA4",
          connected: ga4.ok ? ga4.state.connected : false,
          detail:
            ga4.ok && ga4.state.connected
              ? ga4.state.oauthEmail ?? "connected"
              : "Read GA4 properties + events",
        },
        {
          key: "hubspot",
          label: "HubSpot",
          connected: hub.ok ? hub.state.connected : false,
          detail:
            hub.ok && hub.state.connected
              ? lastPollLabel(hub.state.lastPolledAt)
              : "Poll qualified deals",
        },
        {
          key: "pipedrive",
          label: "Pipedrive",
          connected: pipe.ok ? pipe.state.connected : false,
          detail:
            pipe.ok && pipe.state.connected
              ? lastPollLabel(pipe.state.lastPolledAt)
              : "Poll qualified deals",
        },
        {
          key: "zoho",
          label: "Zoho",
          connected: zoho.ok ? zoho.state.connected : false,
          detail:
            zoho.ok && zoho.state.connected
              ? lastPollLabel(zoho.state.lastPolledAt)
              : "Poll qualified deals",
        },
      ];
      setTiles(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (!tiles) return null;

  return (
    <section className="mt-6">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Connected sources
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.key}
            className={cn(
              "rounded-xl border bg-card p-3",
              t.connected
                ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                : "border-border",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">{t.label}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0 font-mono text-[9.5px] font-semibold uppercase tracking-wider",
                  t.connected
                    ? "border-emerald-500/40 bg-emerald-500/[0.1] text-emerald-700"
                    : "border-muted bg-muted text-muted-foreground",
                )}
              >
                {t.connected ? "connected" : "off"}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {t.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function lastPollLabel(iso: string | null): string {
  if (!iso) return "Polling daily — first run pending";
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 120) return "Last poll: just now";
  if (secs < 3600) return `Last poll: ${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `Last poll: ${Math.floor(secs / 3600)}h ago`;
  return `Last poll: ${Math.floor(secs / 86400)}d ago`;
}
