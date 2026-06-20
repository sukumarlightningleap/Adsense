"use client";

/**
 * Imported groups display + controls for the campaign detail page.
 *
 *   - <ImportedAdGroupsSection>    — SEARCH campaigns
 *   - <ImportedAssetGroupsSection> — PMAX campaigns
 *
 * For each row: name + theme label + status badge + Pause / Enable
 * button. Lets customers RESUME their existing Google Ads work without
 * leaving Adsense — the import surfaced everything; this UI gives them
 * control.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  setAdGroupStatusAction,
  setAssetGroupStatusAction,
} from "./groups-actions";

type GroupStatus = "ENABLED" | "PAUSED" | "REMOVED";

export type AdGroupRow = {
  id: string;
  name: string;
  themeLabel: string | null;
  status: GroupStatus;
  providerAdGroupId: string | null;
  source: "created" | "imported";
};

export type AssetGroupRow = {
  id: string;
  name: string;
  themeLabel: string | null;
  status: GroupStatus;
  providerAssetGroupId: string | null;
  finalUrl: string | null;
  source: "created" | "imported";
};

// ---------------------------------------------------------------------------
// SEARCH — ad groups
// ---------------------------------------------------------------------------

export function ImportedAdGroupsSection({
  campaignId,
  adGroups,
  readOnly,
}: {
  campaignId: string;
  adGroups: AdGroupRow[];
  readOnly: boolean;
}) {
  if (adGroups.length === 0) {
    return (
      <EmptySection
        title="No ad groups yet"
        body="Import this account from /app/accounts to mirror its ad groups here, or launch a new campaign from /app/create."
      />
    );
  }
  return (
    <Section
      title="Ad groups"
      subtitle={`${adGroups.length} group${adGroups.length === 1 ? "" : "s"} in this campaign`}
    >
      <ul className="space-y-2">
        {adGroups.map((g) => (
          <GroupRow
            key={g.id}
            id={g.id}
            campaignId={campaignId}
            name={g.name}
            themeLabel={g.themeLabel}
            status={g.status}
            providerId={g.providerAdGroupId}
            source={g.source}
            kind="ad_group"
            readOnly={readOnly}
          />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// PMAX — asset groups
// ---------------------------------------------------------------------------

export function ImportedAssetGroupsSection({
  campaignId,
  assetGroups,
  readOnly,
}: {
  campaignId: string;
  assetGroups: AssetGroupRow[];
  readOnly: boolean;
}) {
  if (assetGroups.length === 0) {
    return (
      <EmptySection
        title="No asset groups yet"
        body="Import this account from /app/accounts to mirror its asset groups here, or launch a new PMAX campaign from /app/create."
      />
    );
  }
  return (
    <Section
      title="Asset groups"
      subtitle={`${assetGroups.length} group${assetGroups.length === 1 ? "" : "s"} in this campaign`}
    >
      <ul className="space-y-2">
        {assetGroups.map((g) => (
          <GroupRow
            key={g.id}
            id={g.id}
            campaignId={campaignId}
            name={g.name}
            themeLabel={g.themeLabel}
            status={g.status}
            providerId={g.providerAssetGroupId}
            source={g.source}
            kind="asset_group"
            readOnly={readOnly}
            extraLine={g.finalUrl ? `→ ${g.finalUrl}` : undefined}
          />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared row + section + status badge
// ---------------------------------------------------------------------------

function GroupRow({
  id,
  campaignId,
  name,
  themeLabel,
  status,
  providerId,
  source,
  kind,
  readOnly,
  extraLine,
}: {
  id: string;
  campaignId: string;
  name: string;
  themeLabel: string | null;
  status: GroupStatus;
  providerId: string | null;
  source: "created" | "imported";
  kind: "ad_group" | "asset_group";
  readOnly: boolean;
  extraLine?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function flip(newStatus: GroupStatus) {
    setError(null);
    startTransition(async () => {
      const action =
        kind === "ad_group"
          ? setAdGroupStatusAction
          : setAssetGroupStatusAction;
      const r = await action(id, campaignId, newStatus);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const canMutate =
    !readOnly && !!providerId && status !== "REMOVED" && !pending;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground">
            <Layers className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="truncate text-[13.5px] font-semibold">
                {name}
              </span>
              {themeLabel && (
                <span className="rounded border border-border bg-muted/40 px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {themeLabel}
                </span>
              )}
              <StatusPill status={status} />
              {source === "imported" && (
                <span
                  className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  title="Mirrored from Google during import"
                >
                  · imported
                </span>
              )}
            </div>
            {providerId && (
              <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                ID {providerId}
              </div>
            )}
            {extraLine && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {extraLine}
              </div>
            )}
          </div>
        </div>

        {canMutate && (
          <div className="flex shrink-0 gap-2">
            {status === "PAUSED" && (
              <button
                type="button"
                onClick={() => flip("ENABLED")}
                disabled={pending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-emerald-600/85 disabled:opacity-50"
              >
                <Play className="size-3" />
                {pending ? "…" : "Enable"}
              </button>
            )}
            {status === "ENABLED" && (
              <button
                type="button"
                onClick={() => flip("PAUSED")}
                disabled={pending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-amber-600/85 disabled:opacity-50"
              >
                <Pause className="size-3" />
                {pending ? "…" : "Pause"}
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: GroupStatus }) {
  const map = {
    ENABLED: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700",
    PAUSED: "border-amber-500/30 bg-amber-500/[0.08] text-amber-700",
    REMOVED: "border-muted bg-muted text-muted-foreground",
  } as const;
  const label =
    status === "ENABLED" ? "Live" : status === "PAUSED" ? "Paused" : "Removed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0 font-mono text-[10px] font-semibold uppercase tracking-wider",
        map[status],
      )}
    >
      {label}
    </span>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {subtitle}
      </div>
      <div className="mt-1 text-[15px] font-semibold tracking-tight">
        {title}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptySection({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">{body}</p>
    </section>
  );
}
