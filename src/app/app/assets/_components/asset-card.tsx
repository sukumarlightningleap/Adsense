import { ImageIcon, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { deleteAssetAction } from "../actions";

export type AssetCardProps = {
  id: string;
  name: string;
  kind: "image" | "logo" | "pdf" | "video";
  mime: string;
  sha256: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
  demoMode: boolean;
  /** Number of campaigns linked — non-deletable if > 0. */
  linkedCount: number;
  /** Number of auto-generated Google Ads size variants. */
  variantCount: number;
  /** False for demo viewers; true for owners. */
  canDelete: boolean;
};

export function AssetCard(props: AssetCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card",
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-muted">
        {props.kind === "image" || props.kind === "logo" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/assets/${props.id}/bytes`}
            alt={props.name}
            className="size-full object-contain p-3"
          />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <ImageIcon className="size-8" />
          </div>
        )}
        {/* Badge row */}
        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          <span className="rounded-md border border-border bg-background/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground/80 backdrop-blur-sm">
            {props.kind}
          </span>
          {props.demoMode && (
            <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-700 backdrop-blur-sm">
              Demo
            </span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1.5 p-3">
        <div className="truncate text-[13px] font-medium" title={props.name}>
          {props.name}
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">{props.mime.replace("image/", "")}</span>
          {props.width && props.height ? (
            <span className="font-mono">
              {props.width}×{props.height}
            </span>
          ) : (
            <span>{props.createdAt.toISOString().slice(0, 10)}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {props.variantCount > 0 && (
            <span>
              <span className="font-medium text-foreground">
                {props.variantCount}
              </span>{" "}
              variant{props.variantCount === 1 ? "" : "s"}
            </span>
          )}
          {props.linkedCount > 0 && (
            <span>
              On{" "}
              <span className="font-medium text-foreground">
                {props.linkedCount}
              </span>{" "}
              campaign{props.linkedCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Delete (only for owners; never for demo viewers; never if linked) */}
      {props.canDelete && props.linkedCount === 0 && (
        <form action={deleteAssetAction} className="absolute right-2 top-2">
          <input type="hidden" name="assetId" value={props.id} />
          <button
            type="submit"
            aria-label={`Delete ${props.name}`}
            className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
