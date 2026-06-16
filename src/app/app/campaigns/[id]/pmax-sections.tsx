import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  ImageIcon,
  Sparkles,
  Type,
} from "lucide-react";

import { db } from "@/lib/db";
import type { PmaxLaunchPayload } from "@/lib/wizard/payload-builder";
import { cn } from "@/lib/utils";

const ROLES: Array<{
  key: keyof NonNullable<PmaxLaunchPayload["assets"]>;
  title: string;
  aspect: string;
  required: boolean;
}> = [
  { key: "logo_asset_id", title: "Logo", aspect: "1:1", required: true },
  {
    key: "marketing_image_asset_id",
    title: "Marketing image",
    aspect: "1.91:1",
    required: true,
  },
  {
    key: "square_marketing_image_asset_id",
    title: "Square marketing image",
    aspect: "1:1",
    required: true,
  },
  {
    key: "landscape_logo_asset_id",
    title: "Landscape logo",
    aspect: "4:1",
    required: false,
  },
  {
    key: "portrait_marketing_image_asset_id",
    title: "Portrait marketing image",
    aspect: "4:5",
    required: false,
  },
];

/**
 * PMAX-specific sub-resource section: shows the asset group's bound
 * assets organised by role, plus the PMAX ad copy.
 */
export async function PmaxSections({
  payload,
  alreadyLaunched,
}: {
  payload: PmaxLaunchPayload;
  alreadyLaunched: boolean;
}) {
  const assetIds = ROLES.map((r) => payload.assets?.[r.key]).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  const assets = assetIds.length
    ? await db.asset.findMany({
        where: { id: { in: assetIds } },
        select: {
          id: true,
          name: true,
          mime: true,
          width: true,
          height: true,
        },
      })
    : [];

  const byId = new Map(assets.map((a) => [a.id, a]));

  return (
    <>
      {/* Conversion tracking warning — static for now. Day-5+ can wire
          a live check via customer_conversion_goal GAQL query. */}
      <ConversionTrackingNotice alreadyLaunched={alreadyLaunched} />

      {/* Asset group */}
      <section className="mt-10">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Asset group
        </div>
        <div className="mt-1 text-[15px] font-semibold tracking-tight">
          Bound assets per Google Ads role
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((role) => {
            const assetId = payload.assets?.[role.key];
            const asset = assetId ? byId.get(assetId) : undefined;
            return (
              <RoleCard
                key={role.key}
                title={role.title}
                aspect={role.aspect}
                required={role.required}
                assetId={assetId}
                asset={asset ?? null}
              />
            );
          })}
        </div>
      </section>

      {/* PMAX ad copy */}
      <section className="mt-10">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Ad copy
        </div>
        <div className="mt-1 text-[15px] font-semibold tracking-tight">
          PMAX text assets
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <CopyCard
            icon={<Building2 className="size-3.5" />}
            label="Business name"
            single={payload.ad_copy.business_name}
          />
          <CopyCard
            icon={<Type className="size-3.5" />}
            label={`Short headlines · ${payload.ad_copy.headlines.length}`}
            items={payload.ad_copy.headlines}
          />
          <CopyCard
            icon={<Type className="size-3.5" />}
            label={`Long headlines · ${payload.ad_copy.long_headlines.length}`}
            items={payload.ad_copy.long_headlines}
          />
          <CopyCard
            icon={<Type className="size-3.5" />}
            label={`Descriptions · ${payload.ad_copy.descriptions.length}`}
            items={payload.ad_copy.descriptions}
          />
        </div>
      </section>
    </>
  );
}

function RoleCard({
  title,
  aspect,
  required,
  assetId,
  asset,
}: {
  title: string;
  aspect: string;
  required: boolean;
  assetId: string | undefined;
  asset: {
    id: string;
    name: string | null;
    mime: string;
    width: number | null;
    height: number | null;
  } | null;
}) {
  const hasAsset = !!asset;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        hasAsset ? "border-border" : "border-dashed border-border bg-card/40",
      )}
    >
      <div className="relative aspect-[1.91/1] bg-muted">
        {asset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/assets/${asset.id}/bytes`}
            alt={asset.name ?? title}
            className="size-full object-contain p-3"
          />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <ImageIcon className="size-8 opacity-40" />
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-medium">{title}</div>
          {required ? (
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider",
                hasAsset
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                  : "border-destructive/30 bg-destructive/5 text-destructive",
              )}
            >
              {hasAsset ? "Set" : "Missing"}
            </span>
          ) : (
            <span className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Optional
            </span>
          )}
          <code className="ml-auto font-mono text-[10px] text-muted-foreground">
            {aspect}
          </code>
        </div>
        {asset ? (
          <Link
            href={`/app/assets/${asset.id}`}
            className="block text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            {asset.name ?? "Untitled"}
            {asset.width && asset.height && (
              <span className="ml-1.5 font-mono text-[10px]">
                ({asset.width}×{asset.height})
              </span>
            )}
          </Link>
        ) : assetId ? (
          <div className="text-[11.5px] text-amber-700">
            Picked asset not found
          </div>
        ) : (
          <div className="text-[11.5px] text-muted-foreground">
            Not picked
          </div>
        )}
      </div>
    </div>
  );
}

function CopyCard({
  icon,
  label,
  single,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  single?: string;
  items?: string[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </div>
      <div className="mt-3">
        {single !== undefined ? (
          <div className="text-[14px] font-medium">{single || "—"}</div>
        ) : (
          <ul className="space-y-1.5">
            {(items ?? []).map((it, i) => (
              <li
                key={i}
                className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[12px] text-foreground"
              >
                {it}
              </li>
            ))}
            {(!items || items.length === 0) && (
              <li className="text-[12px] text-muted-foreground">—</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConversionTrackingNotice({
  alreadyLaunched,
}: {
  alreadyLaunched: boolean;
}) {
  return (
    <section className="mt-10">
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border p-4",
          alreadyLaunched
            ? "border-amber-500/30 bg-amber-500/[0.06]"
            : "border-border bg-muted/30",
        )}
      >
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
            alreadyLaunched
              ? "bg-amber-500 text-white"
              : "bg-foreground text-background",
          )}
        >
          {alreadyLaunched ? (
            <AlertTriangle className="size-4" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </span>
        <div className="flex-1">
          <div className="text-[13.5px] font-semibold">
            Conversion tracking is required for PMAX
          </div>
          <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
            Performance Max bidding (Maximize Conversions / Conversion Value /
            Target CPA / Target ROAS) is blind without conversions. Verify
            on{" "}
            <a
              href="https://ads.google.com/aw/conversions"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Google Ads → Tools → Conversions
            </a>{" "}
            that at least one conversion action is{" "}
            <span className="font-mono">Included in &quot;Conversions&quot;</span>.
          </p>
        </div>
      </div>
    </section>
  );
}
