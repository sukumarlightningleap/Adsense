"use client";

import { motion } from "motion/react";
import { Check, FileText } from "lucide-react";

import { buildCampaignYaml } from "@/lib/wizard/yaml-builder";
import {
  SUPPORTED_COUNTRIES,
  type CampaignDraft,
} from "@/lib/wizard/schema";

import type { AccountOption } from "../wizard";

type Props = {
  accounts: AccountOption[];
  draft: CampaignDraft;
  error: string | null;
  pending: boolean;
};

export function StepReview({ accounts, draft, error, pending }: Props) {
  const account = accounts.find((a) => a.id === draft.accountId);
  const country =
    SUPPORTED_COUNTRIES.find((c) => c.code === draft.audience.country)
      ?.name ?? draft.audience.country;

  const yamlText = (() => {
    try {
      return buildCampaignYaml(draft);
    } catch {
      return "# (Cannot render — draft has invalid data. Go back and fix the flagged step.)";
    }
  })();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SummarySection title={`Account · ${draft.channel}`}>
          <Row label="Account" value={account?.name ?? "—"} />
          <Row label="Customer ID" value={account?.customerId ?? "—"} mono />
          <Row label="Currency" value={account?.currencyCode ?? "—"} />
        </SummarySection>

        <SummarySection title="Product">
          <Row label="Title" value={draft.book.title || "—"} />
          <Row
            label="Landing URL"
            value={draft.book.landingPageUrl || "—"}
            mono
            truncate
          />
          {draft.book.isbn && (
            <Row label="ISBN/SKU" value={draft.book.isbn} mono />
          )}
        </SummarySection>

        <SummarySection title="Audience">
          <Row label="Country" value={country} />
          <Row label="Scope" value={draft.audience.scope.replace("_", " ")} />
          {draft.audience.scope === "specific_cities" && (
            <Row
              label="Cities"
              value={(draft.audience.cities ?? []).join(", ") || "—"}
            />
          )}
        </SummarySection>

        <SummarySection title="Budget &amp; Bidding">
          {draft.channel === "SEARCH" ? (
            <>
              <Row
                label="Daily budget"
                value={`$${draft.searchBudget!.dailyUsd}/day`}
              />
              <Row
                label="Strategy"
                value={draft.searchBudget!.biddingStrategy}
                mono
              />
              {draft.searchBudget!.maxCpcUsd != null && (
                <Row label="Max CPC" value={`$${draft.searchBudget!.maxCpcUsd}`} />
              )}
              {draft.searchBudget!.targetCpaUsd != null && (
                <Row
                  label="Target CPA"
                  value={`$${draft.searchBudget!.targetCpaUsd}`}
                />
              )}
            </>
          ) : (
            <>
              <Row
                label="Daily budget"
                value={`$${draft.pmaxBudget!.dailyUsd}/day`}
              />
              <Row
                label="Strategy"
                value={draft.pmaxBudget!.biddingStrategy}
                mono
              />
              {draft.pmaxBudget!.targetCpaUsd != null && (
                <Row
                  label="Target CPA"
                  value={`$${draft.pmaxBudget!.targetCpaUsd}`}
                />
              )}
              {draft.pmaxBudget!.targetRoas != null && (
                <Row
                  label="Target ROAS"
                  value={`${draft.pmaxBudget!.targetRoas} (${(draft.pmaxBudget!.targetRoas * 100).toFixed(0)}%)`}
                />
              )}
            </>
          )}
        </SummarySection>
      </div>

      {/* Ad copy counts */}
      <SummarySection title="Ad copy">
        {draft.channel === "SEARCH" ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <CountTile
              label="Headlines"
              count={draft.searchAdCopy!.headlines.length}
            />
            <CountTile
              label="Descriptions"
              count={draft.searchAdCopy!.descriptions.length}
            />
            <CountTile
              label="Keywords"
              count={draft.searchAdCopy!.keywords.length}
            />
            <CountTile
              label="Negatives"
              count={draft.searchAdCopy!.negativeKeywords?.length ?? 0}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <CountTile
              label="Short headlines"
              count={draft.pmaxAdCopy!.headlines.length}
            />
            <CountTile
              label="Long headlines"
              count={draft.pmaxAdCopy!.longHeadlines.length}
            />
            <CountTile
              label="Descriptions"
              count={draft.pmaxAdCopy!.descriptions.length}
            />
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Business name
              </div>
              <div
                className="mt-1 truncate text-[13px] font-medium"
                title={draft.pmaxAdCopy!.businessName}
              >
                {draft.pmaxAdCopy!.businessName || "—"}
              </div>
            </div>
          </div>
        )}
      </SummarySection>

      {/* YAML preview */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            YAML payload (what the launcher will push to Google Ads)
          </span>
        </div>
        <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-muted/30 p-4 font-mono text-[11px] leading-5">
          {yamlText}
        </pre>
      </div>

      {/* Safety note */}
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 text-[12.5px] text-emerald-700">
        <Check className="mt-0.5 size-3.5 shrink-0" />
        <div>
          <span className="font-medium">Saved as PAUSED.</span>{" "}
          {draft.channel === "PMAX"
            ? "PMAX launch wiring lands in Phase 6 Day 2; for now you can save the draft and inspect the payload."
            : "Nothing pushes to Google Ads yet — open the campaign detail page to launch."}
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive"
          role="alert"
        >
          {error}
        </motion.div>
      )}

      {pending && (
        <div className="text-[12px] text-muted-foreground">
          Saving draft to your workspace…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI atoms (unchanged)
// ---------------------------------------------------------------------------
function SummarySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="mt-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 text-right text-[12.5px] font-medium ${
          mono ? "font-mono" : ""
        } ${truncate ? "truncate" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function CountTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{count}</div>
    </div>
  );
}
