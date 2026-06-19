"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, ImagePlus, Sparkles, Wand2, X, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CampaignDraft } from "@/lib/wizard/schema";

import { generateAssetsAction } from "../actions";

type PipelineMode = "fast" | "refined";

export type LibraryAsset = {
  id: string;
  name: string | null;
  kind: "image" | "logo" | "pdf" | "video";
  width: number | null;
  height: number | null;
  mime: string;
};

type Props = {
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
  library: LibraryAsset[];
};

type RoleKey =
  | "logoAssetId"
  | "landscapeLogoAssetId"
  | "marketingImageAssetId"
  | "squareMarketingImageAssetId"
  | "portraitMarketingImageAssetId";

type RoleSpec = {
  key: RoleKey;
  title: string;
  description: string;
  aspect: string;
  /** Which library kind values are valid for this role. */
  kindFilter: ("image" | "logo")[];
  required: boolean;
};

const ROLES: RoleSpec[] = [
  {
    key: "logoAssetId",
    title: "Logo",
    description: "Used in every PMAX placement. Square 1:1.",
    aspect: "1:1",
    kindFilter: ["logo"],
    required: true,
  },
  {
    key: "marketingImageAssetId",
    title: "Marketing image",
    description: "Landscape hero. Search + Display + Discover.",
    aspect: "1.91:1",
    kindFilter: ["image"],
    required: true,
  },
  {
    key: "squareMarketingImageAssetId",
    title: "Square marketing image",
    description: "Feeds, mobile, grid placements.",
    aspect: "1:1",
    kindFilter: ["image"],
    required: true,
  },
  {
    key: "landscapeLogoAssetId",
    title: "Landscape logo",
    description: "Optional. Improves placements where 4:1 fits.",
    aspect: "4:1",
    kindFilter: ["logo"],
    required: false,
  },
  {
    key: "portraitMarketingImageAssetId",
    title: "Portrait marketing image",
    description: "Optional. Mobile stories + portrait placements.",
    aspect: "4:5",
    kindFilter: ["image"],
    required: false,
  },
];

export function StepAssets({ draft, onChange, library }: Props) {
  const picks = draft.pmaxAssets ?? {};

  function update(patch: Partial<NonNullable<CampaignDraft["pmaxAssets"]>>) {
    onChange({
      ...draft,
      pmaxAssets: { ...draft.pmaxAssets, ...patch },
    });
  }

  return (
    <div className="space-y-4">
      <AIAssetsBar draft={draft} onChange={onChange} />

      {library.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <>
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12.5px] text-muted-foreground">
            Pick the source image for each role. The launcher auto-resolves
            the right Google Ads size from your sharp-generated variants —
            you don&apos;t need to upload separate crops.
          </p>

          {ROLES.map((role) => (
            <RoleSection
              key={role.key}
              role={role}
              library={library}
              currentAssetId={picks[role.key]}
              onPick={(id) => update({ [role.key]: id ?? undefined })}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI generate bar — produces 4 PMAX images (marketing, square, portrait,
// logo) via Gemini, pushes them through the same sharp pipeline uploads
// use, and assigns the resulting IDs to the matching role slots.
// ---------------------------------------------------------------------------
function AIAssetsBar({
  draft,
  onChange,
}: {
  draft: CampaignDraft;
  onChange: (next: CampaignDraft) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PipelineMode>("fast");

  const canGenerate =
    draft.book.title.trim().length > 0 &&
    draft.book.description.trim().length > 0;

  function onGenerate() {
    setError(null);
    startTransition(async () => {
      const res = await generateAssetsAction(draft, mode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChange({
        ...draft,
        pmaxAssets: {
          ...draft.pmaxAssets,
          ...res.ids,
        },
      });
      // Refresh so the freshly-persisted Asset rows appear in the
      // picker grid (library is fetched by the server component above).
      router.refresh();
    });
  }

  const modeCopy =
    mode === "fast"
      ? "Fast · 2 image calls, ~10s. One master image cropped to all 5 Google Ads sizes."
      : "Refined · 5 image calls, ~25s. Whisk-style: subject + scene + style intermediates → fused master. Higher fidelity to your brief.";

  return (
    <div className="rounded-xl border border-dashed border-border bg-gradient-to-br from-violet-500/[0.04] to-transparent p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-background">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold">
              Generate images with AI
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {canGenerate
                ? modeCopy
                : "Add a title and description on step 1 first."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModeToggle value={mode} onChange={setMode} disabled={pending} />
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || pending}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-[12.5px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="size-3.5" />
            {pending ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Two-pill toggle for picking the pipeline mode. Inline (no shadcn
 * dependency) — same shape as a segmented control.
 *
 * TEMPORARY: this lives in the UI only while we A/B test the two
 * pipelines. Remove the toggle + force one mode once a winner is picked.
 */
function ModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: PipelineMode;
  onChange: (next: PipelineMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Pipeline mode"
      className={cn(
        "inline-flex rounded-md border border-border bg-background p-0.5",
        disabled && "opacity-50",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "fast"}
        disabled={disabled}
        onClick={() => onChange("fast")}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
          value === "fast"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Zap className="size-3" />
        Fast
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "refined"}
        disabled={disabled}
        onClick={() => onChange("refined")}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
          value === "refined"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Wand2 className="size-3" />
        Refined
      </button>
    </div>
  );
}

function RoleSection({
  role,
  library,
  currentAssetId,
  onPick,
}: {
  role: RoleSpec;
  library: LibraryAsset[];
  currentAssetId: string | undefined;
  onPick: (assetId: string | undefined) => void;
}) {
  const [picking, setPicking] = useState(false);
  const matching = library.filter((a) =>
    role.kindFilter.includes(a.kind as "image" | "logo"),
  );
  const current = library.find((a) => a.id === currentAssetId);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{role.title}</h3>
            {role.required ? (
              <span className="rounded-md border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-destructive">
                Required
              </span>
            ) : (
              <span className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Optional
              </span>
            )}
            <code className="font-mono text-[10.5px] text-muted-foreground">
              {role.aspect}
            </code>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {role.description}
          </p>
        </div>
      </div>

      {/* Current pick / picker */}
      <div className="mt-4">
        {current ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/assets/${current.id}/bytes`}
              alt={current.name ?? "Asset"}
              className="size-14 rounded-md border border-border object-contain"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">
                {current.name ?? "Untitled"}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {current.width && current.height
                  ? `${current.width}×${current.height} · `
                  : ""}
                {current.mime}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setPicking((v) => !v)}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-medium hover:bg-muted"
              >
                Change
              </button>
              {!role.required && (
                <button
                  type="button"
                  onClick={() => onPick(undefined)}
                  aria-label="Clear"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-border bg-background px-4 py-3 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-muted/30"
          >
            <ImagePlus className="size-4" />
            Pick a {role.title.toLowerCase()}
            {matching.length > 0 && (
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {matching.length} available
              </span>
            )}
          </button>
        )}
      </div>

      {/* Picker grid */}
      <AnimatePresence initial={false}>
        {picking && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Library · {matching.length} match
                  {matching.length === 1 ? "" : "es"}
                </span>
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label="Close picker"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {matching.length === 0 ? (
                <EmptyMatchHint role={role} />
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {matching.map((a) => {
                    const active = currentAssetId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          onPick(a.id);
                          setPicking(false);
                        }}
                        className={cn(
                          "group relative overflow-hidden rounded-md border bg-background transition-colors",
                          active
                            ? "border-foreground ring-2 ring-foreground/30"
                            : "border-border hover:border-foreground/40",
                        )}
                        title={a.name ?? "Untitled"}
                      >
                        <div className="relative aspect-square bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/assets/${a.id}/bytes`}
                            alt={a.name ?? "Asset"}
                            className="size-full object-contain p-2"
                          />
                          {/* Dimension chip — info, not validation. sharp
                              auto-crops at upload, so any aspect works. */}
                          {a.width && a.height && (
                            <span className="absolute bottom-1 left-1 rounded-sm bg-background/85 px-1 font-mono text-[9px] text-muted-foreground backdrop-blur-sm">
                              {a.width}×{a.height}
                            </span>
                          )}
                        </div>
                        <div className="truncate px-2 py-1 text-left text-[10.5px]">
                          {a.name ?? "Untitled"}
                        </div>
                        {active && (
                          <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background">
                            <CheckCircle2 className="size-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyMatchHint({ role }: { role: RoleSpec }) {
  const hint =
    role.kindFilter[0] === "logo"
      ? "No logos in your library yet."
      : "No images in your library yet.";
  return (
    <div className="rounded-md border border-dashed border-border bg-background/60 px-3 py-4 text-center text-[12.5px] text-muted-foreground">
      <div>{hint}</div>
      <Link
        href="/app/assets"
        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-foreground hover:underline"
      >
        Upload one →
      </Link>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
      <div className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
        <Sparkles className="size-5" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        No assets in your library
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-muted-foreground">
        PMAX needs at least a logo, a marketing image, and a square marketing
        image. Upload them from the asset library — variants generate
        automatically.
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          href="/app/assets"
          className="inline-flex h-10 items-center gap-1.5 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/80"
        >
          <ImagePlus className="size-4" />
          Upload assets
        </Link>
      </div>
    </div>
  );
}
