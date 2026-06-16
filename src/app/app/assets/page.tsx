import { ImageIcon } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";

import { AssetCard } from "./_components/asset-card";
import { UploadForm } from "./_components/upload-form";

export const metadata = {
  title: "Assets",
};

export default async function AssetsPage() {
  const session = await auth();
  const user = session!.user;
  const demoMode = await getEffectiveDemoMode(user.role);

  // Fetch in parallel. Don't select `bytes` — large columns kill list
  // performance; the dedicated `/api/assets/[id]/bytes` route streams them.
  //
  // Filter to originals only (parentAssetId NULL) — the grid is meant
  // for top-level images; the variants are visible on the detail page.
  const [assets, accounts] = await Promise.all([
    db.asset.findMany({
      where: demoMode
        ? { demoMode: true, parentAssetId: null }
        : { userId: user.id, demoMode: false, parentAssetId: null },
      select: {
        id: true,
        name: true,
        kind: true,
        mime: true,
        sha256: true,
        width: true,
        height: true,
        createdAt: true,
        demoMode: true,
        _count: {
          select: { campaignLinks: true, variants: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    user.role !== "demo"
      ? db.adsAccount.findMany({
          where: { userId: user.id, demoMode: false },
          select: { id: true, descriptiveName: true, customerId: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([] as never[]),
  ]);

  const canUpload = user.role !== "demo" && !demoMode;

  return (
    <div className="container-page py-12 md:py-16">
      {/* Header */}
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          <span className="size-1 rounded-full bg-brand" />
          Assets · {demoMode ? "Demo data" : "Live data"}
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Asset library
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
          Every image and logo uploaded across your workspace. Sized
          variants for Google Ads (1200×628, 1200×1200, 960×1200, square
          logo, landscape logo) land in Day 2.
        </p>
      </header>

      {/* Upload */}
      {canUpload && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-8">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Upload
          </div>
          <div className="mt-4">
            <UploadForm
              accounts={accounts.map((a) => ({
                id: a.id,
                name: a.descriptiveName ?? `Customer ${a.customerId}`,
              }))}
            />
          </div>
        </section>
      )}

      {/* Library */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Library · {assets.length} asset{assets.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-4">
          {assets.length === 0 ? (
            <EmptyState demoMode={demoMode} canUpload={canUpload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {assets.map((a) => (
                <AssetCard
                  key={a.id}
                  id={a.id}
                  name={a.name ?? "Untitled"}
                  kind={a.kind}
                  mime={a.mime}
                  sha256={a.sha256}
                  width={a.width}
                  height={a.height}
                  createdAt={a.createdAt}
                  demoMode={a.demoMode}
                  variantCount={a._count.variants}
                  linkedCount={a._count.campaignLinks}
                  canDelete={user.role !== "demo" && !a.demoMode}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyState({
  demoMode,
  canUpload,
}: {
  demoMode: boolean;
  canUpload: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
      <div className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
        <ImageIcon className="size-5" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        {demoMode ? "No demo assets" : "No assets yet"}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-muted-foreground">
        {demoMode
          ? "An admin needs to seed demo data to populate this view."
          : canUpload
            ? "Upload your first image or logo using the form above. Day 2 adds automatic resizing to Google Ads dimensions."
            : "Switch to Live mode to upload your own assets."}
      </p>
    </div>
  );
}
