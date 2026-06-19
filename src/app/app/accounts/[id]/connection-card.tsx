"use client";

/**
 * Connection card for the account detail page.
 *
 * Shows OAuth + import status, lets the user trigger a fresh import.
 * Surfaces the result counts (campaigns, ad groups, keywords, etc.) so
 * the customer immediately sees what we mirrored.
 */
import { useState, useTransition } from "react";
import { CheckCircle2, Download, Link2, RefreshCw } from "lucide-react";

import type { ImportResult } from "@/lib/google-ads/importer";
import { cn } from "@/lib/utils";

import { runImportAction, type RunImportResult } from "./import-action";

type Props = {
  accountId: string;
  connected: boolean;
  connectedAt: string | null;
  lastImportedAt: string | null;
};

export function ConnectionCard({
  accountId,
  connected,
  connectedAt,
  lastImportedAt,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunImportResult | null>(null);

  function onImport() {
    setResult(null);
    startTransition(async () => {
      const r = await runImportAction(accountId);
      setResult(r);
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-md",
              connected
                ? "bg-emerald-500/15 text-emerald-700"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Link2 className="size-4" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">
              Google Ads connection
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {connected
                ? `Connected${connectedAt ? ` · ${friendlyDate(connectedAt)}` : ""}.`
                : "Not connected via OAuth. Using shared developer credentials."}
            </p>
            {lastImportedAt && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Last imported · {friendlyDate(lastImportedAt)}
              </p>
            )}
          </div>
        </div>

        {/* Import button is available for ANY live account — OAuth-
            connected rows use their per-account token, legacy / manually-
            added rows fall back to the env-based dev refresh token. The
            importer's credential resolver picks the right one; if neither
            is available, it throws a clear error which surfaces below. */}
        <button
          type="button"
          onClick={onImport}
          disabled={pending}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-[12.5px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {lastImportedAt ? (
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
          ) : (
            <Download className={cn("size-3.5", pending && "animate-pulse")} />
          )}
          {pending
            ? "Importing…"
            : lastImportedAt
              ? "Re-import"
              : "Import now"}
        </button>
      </div>

      {result && (
        <div className="mt-4 border-t border-border pt-4">
          {result.ok ? (
            <ResultGrid result={result.result} />
          ) : (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {result.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ResultGrid({ result }: { result: ImportResult }) {
  // Manager accounts get a single-tile result (sub-accounts discovered);
  // client accounts get the full 5-tile breakdown.
  const isManagerImport = result.counts.subAccountsDiscovered !== undefined;
  const items = isManagerImport
    ? [
        {
          label: "Sub-accounts discovered",
          value: result.counts.subAccountsDiscovered ?? 0,
        },
      ]
    : [
        { label: "Campaigns", value: result.counts.campaigns },
        { label: "Ad groups", value: result.counts.adGroups },
        { label: "Keywords", value: result.counts.keywords },
        { label: "Asset groups", value: result.counts.assetGroups },
        {
          label: "Conversion actions",
          value: result.counts.conversionActions,
        },
      ];
  return (
    <>
      <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-700">
        <CheckCircle2 className="size-3.5" />
        Imported in {(result.durationMs / 1000).toFixed(1)}s
        {result.customerInfo.descriptiveName &&
          ` · ${result.customerInfo.descriptiveName}`}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-border bg-background px-3 py-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {it.label}
            </div>
            <div className="mt-1 font-mono text-[14px] font-medium tabular-nums">
              {it.value}
            </div>
          </div>
        ))}
      </div>
      {result.errors.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11.5px] text-muted-foreground hover:text-foreground">
            {result.errors.length} partial error
            {result.errors.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-destructive">
            {result.errors.map((err, i) => (
              <li key={i} className="font-mono">
                {err}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
