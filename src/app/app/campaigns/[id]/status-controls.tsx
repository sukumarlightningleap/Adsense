"use client";

/**
 * Inline Pause / Enable / Remove + Refresh controls for the campaign
 * detail page. Writes go to Google Ads via the server action; on
 * success the page revalidates and the status badge re-renders.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  refreshCampaignAction,
  setCampaignStatusAction,
} from "./control-actions";

type Props = {
  campaignId: string;
  currentStatus: "ENABLED" | "PAUSED" | "REMOVED";
  hasProviderId: boolean;
  isDemo: boolean;
};

export function StatusControls({
  campaignId,
  currentStatus,
  hasProviderId,
  isDemo,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Demo campaigns are read-only. Non-launched campaigns (no
  // providerCampaignId) have nothing to control on Google's side.
  if (isDemo || !hasProviderId || currentStatus === "REMOVED") {
    return null;
  }

  function call(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? "Unknown error.");
      else router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {currentStatus === "PAUSED" && (
        <button
          type="button"
          onClick={() =>
            call(() => setCampaignStatusAction(campaignId, "ENABLED"))
          }
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-emerald-600/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="size-3.5" />
          {pending ? "Enabling…" : "Enable"}
        </button>
      )}

      {currentStatus === "ENABLED" && (
        <button
          type="button"
          onClick={() =>
            call(() => setCampaignStatusAction(campaignId, "PAUSED"))
          }
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-amber-600/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pause className="size-3.5" />
          {pending ? "Pausing…" : "Pause"}
        </button>
      )}

      <button
        type="button"
        onClick={() => call(() => refreshCampaignAction(campaignId))}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title="Pull the campaign's current name + status from Google"
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        Refresh from Google
      </button>

      <div className="ml-auto">
        {!confirmingRemove ? (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-3 text-[12px] font-medium text-destructive hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            Remove
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-[11.5px] text-destructive">
            <AlertTriangle className="size-3.5" />
            <span>Remove permanently?</span>
            <button
              type="button"
              onClick={() =>
                call(() =>
                  setCampaignStatusAction(campaignId, "REMOVED"),
                )
              }
              disabled={pending}
              className="rounded bg-destructive px-2 py-0.5 text-[11px] font-medium text-white hover:bg-destructive/85"
            >
              Yes, remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="basis-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
