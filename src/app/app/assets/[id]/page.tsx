import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ImageIcon, Megaphone, Trash2 } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";
import { cn } from "@/lib/utils";

import { deleteAssetAction } from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return { title: "Asset" };
  const demoMode = await getEffectiveDemoMode(session.user.role);
  const a = await db.asset.findFirst({
    where: demoMode
      ? { id, demoMode: true }
      : { id, userId: session.user.id, demoMode: false },
    select: { name: true },
  });
  return { title: a?.name ?? "Asset" };
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);

  // Detail page is for ORIGINALS only — variants don't get their own page.
  // If the URL points at a variant, redirect logic could jump to the
  // parent, but for now we 404 (variants aren't linked anywhere by the UI).
  const asset = await db.asset.findFirst({
    where: demoMode
      ? { id, demoMode: true, parentAssetId: null }
      : {
          id,
          userId: user.id,
          demoMode: false,
          parentAssetId: null,
        },
    include: {
      variants: {
        select: {
          id: true,
          name: true,
          width: true,
          height: true,
          mime: true,
          sha256: true,
          variantRole: true,
        },
        orderBy: [{ variantRole: "asc" }],
      },
      campaignLinks: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
              channelType: true,
            },
          },
        },
      },
      account: {
        select: { id: true, descriptiveName: true, customerId: true },
      },
    },
  });
  if (!asset) notFound();

  const canDelete =
    user.role !== "demo" &&
    !asset.demoMode &&
    asset.campaignLinks.length === 0;

  return (
    <div className="container-page py-12 md:py-16">
      {/* Breadcrumb */}
      <Link
        href="/app/assets"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Assets
      </Link>

      {/* Header */}
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
            {asset.name ?? "Untitled asset"}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <KindBadge kind={asset.kind} />
            {asset.demoMode && (
              <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                Demo
              </span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground">
              {asset.mime}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/assets/${asset.id}/bytes`}
            download={asset.name ?? "asset"}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] font-medium hover:bg-muted"
          >
            <Download className="size-3.5" />
            Download
          </a>
          {canDelete && (
            <form action={deleteAssetAction}>
              <input type="hidden" name="assetId" value={asset.id} />
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 text-[13px] font-medium text-destructive hover:bg-destructive/[0.12]"
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            </form>
          )}
        </div>
      </header>

      {/* Meta strip */}
      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetaTile
          label="Dimensions"
          value={
            asset.width && asset.height
              ? `${asset.width}×${asset.height}`
              : "—"
          }
        />
        <MetaTile
          label="Variants"
          value={asset.variants.length.toString()}
        />
        <MetaTile
          label="Created"
          value={asset.createdAt.toISOString().slice(0, 10)}
        />
        <MetaTile
          label="Account"
          value={
            asset.account?.descriptiveName ??
            (asset.account
              ? `Customer ${asset.account.customerId}`
              : "Not tagged")
          }
        />
      </section>

      {/* Original */}
      <section className="mt-10">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Original
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid place-items-center bg-muted/30 p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/assets/${asset.id}/bytes`}
              alt={asset.name ?? "Asset original"}
              className="max-h-[480px] w-auto object-contain"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px]">
            <span className="font-mono text-muted-foreground">
              sha256 {asset.sha256.slice(0, 12)}…{asset.sha256.slice(-6)}
            </span>
            {asset.width && asset.height && (
              <span className="font-mono text-muted-foreground">
                {asset.width}×{asset.height}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Variants */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Google Ads variants · {asset.variants.length}
          </div>
        </div>

        {asset.variants.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground">
            No sized variants. (Demo assets and pre-sharp uploads don&apos;t
            have them. Re-upload to generate.)
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {asset.variants.map((v) => (
              <VariantCard
                key={v.id}
                id={v.id}
                name={v.name ?? "Variant"}
                width={v.width}
                height={v.height}
                role={v.variantRole}
                sha256={v.sha256}
              />
            ))}
          </div>
        )}
      </section>

      {/* Linked campaigns */}
      {asset.campaignLinks.length > 0 && (
        <section className="mt-10">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Linked campaigns · {asset.campaignLinks.length}
          </div>
          <ul className="mt-4 space-y-2">
            {asset.campaignLinks.map((link) => (
              <li key={link.assetId + link.campaignId}>
                <Link
                  href={`/app/campaigns/${link.campaign.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground/[0.06]">
                      <Megaphone className="size-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">
                        {link.campaign.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {link.role} · {link.campaign.channelType}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={link.campaign.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Footer with delete protection note (if linked) */}
      {asset.campaignLinks.length > 0 && (
        <p className="mt-8 rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          This asset is linked to{" "}
          <span className="font-medium text-foreground">
            {asset.campaignLinks.length} campaign
            {asset.campaignLinks.length === 1 ? "" : "s"}
          </span>{" "}
          and can&apos;t be deleted until you unlink them.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant card
// ---------------------------------------------------------------------------
function VariantCard({
  id,
  name,
  width,
  height,
  role,
  sha256,
}: {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  role: string | null;
  sha256: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-square bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/assets/${id}/bytes`}
          alt={name}
          className="size-full object-contain p-2"
        />
        <a
          href={`/api/assets/${id}/bytes`}
          download={`${role ?? "variant"}-${id}.png`}
          className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label={`Download ${name}`}
        >
          <Download className="size-3.5" />
        </a>
      </div>
      <div className="space-y-1 p-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-brand">
          {prettyRole(role)}
        </div>
        <div className="font-mono text-[11px] text-foreground">
          {width && height ? `${width}×${height}` : "—"}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          sha {sha256.slice(0, 6)}
        </div>
      </div>
    </div>
  );
}

function prettyRole(role: string | null): string {
  if (!role) return "—";
  return role.replace(/_/g, " ");
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
      {kind}
    </span>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-[14px] font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ENABLED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    PAUSED: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    REMOVED: "bg-muted text-muted-foreground border-border",
  };
  const label =
    status === "ENABLED" ? "Live" : status === "PAUSED" ? "Paused" : "Removed";
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium",
        map[status] ?? "border-border bg-muted",
      )}
    >
      {label}
    </span>
  );
}
