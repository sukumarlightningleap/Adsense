"use client";

/**
 * Black-box ad preview — the autopilot UX.
 *
 * Customer enters a 1-page brief (brand + description + optional URL),
 * clicks Generate, and sees the ad rendered inside live Google
 * placements. The architect, pipeline, sector-pick, and image generation
 * all happen invisibly behind one server action.
 */
import { useState, useTransition } from "react";
import { Sparkles, Wand2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { generatePreviewAction, type PreviewResult } from "./actions";
import {
  DiscoverCardMockup,
  DisplayBannerMockup,
  SearchSerpMockup,
} from "./mockups";

export function PreviewForm() {
  const [brandName, setBrandName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    (PreviewResult & { ok: true }) | null
  >(null);

  const canGenerate =
    brandName.trim().length > 0 &&
    productDescription.trim().length >= 10 &&
    !pending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canGenerate) return;
    setError(null);

    startTransition(async () => {
      const res = await generatePreviewAction({
        brandName,
        productDescription,
        landingPageUrl: landingPageUrl || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        setResult(null);
        return;
      }
      setResult(res);
    });
  }

  // Build the shared content object passed to all three mockups. The
  // pipeline writes assets to `/api/assets/:id/bytes`; the same URLs we
  // use everywhere else.
  const adContent = result
    ? {
        brandName: result.meta.brandName,
        landingDomain: result.meta.landingDomain,
        headline: result.copy.headlines[0] ?? result.meta.brandName,
        description:
          result.copy.descriptions[0] ?? result.copy.headlines[1] ?? "",
        longHeadline: result.copy.longHeadline,
        heroUrl: result.assetIds.marketingImageAssetId
          ? `/api/assets/${result.assetIds.marketingImageAssetId}/bytes`
          : undefined,
        squareUrl: result.assetIds.squareMarketingImageAssetId
          ? `/api/assets/${result.assetIds.squareMarketingImageAssetId}/bytes`
          : undefined,
        logoUrl: result.assetIds.logoAssetId
          ? `/api/assets/${result.assetIds.logoAssetId}/bytes`
          : undefined,
      }
    : null;

  return (
    <div className="container-page py-10 md:py-14">
      {/* Header */}
      <header className="max-w-2xl">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3" />
          Autopilot preview
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
          See your ad on Google
        </h1>
        <p className="mt-3 max-w-xl text-[14px] leading-6 text-muted-foreground">
          Tell us about your business in two lines. We'll generate the copy
          and the images, then render them inside live Google placements so
          you can see exactly how your ad will look.
        </p>
      </header>

      {/* Brief form */}
      <form
        onSubmit={onSubmit}
        className="mt-8 grid max-w-2xl gap-5 rounded-2xl border border-border bg-card p-6"
      >
        <div className="grid gap-2">
          <Label htmlFor="brandName" className="text-[13px] font-medium">
            Brand name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="brandName"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="e.g. Ballast Books"
            maxLength={50}
            disabled={pending}
            className="h-10"
          />
        </div>

        <div className="grid gap-2">
          <Label
            htmlFor="productDescription"
            className="text-[13px] font-medium"
          >
            What do you sell? <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="productDescription"
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
            placeholder="e.g. Independent publisher of self-help and personal-development books. We help busy professionals find practical lessons in 200 pages or less."
            rows={4}
            maxLength={1000}
            disabled={pending}
          />
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {productDescription.length} / 1000
          </span>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="landingPageUrl" className="text-[13px] font-medium">
            Landing page URL{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="landingPageUrl"
            type="url"
            value={landingPageUrl}
            onChange={(e) => setLandingPageUrl(e.target.value)}
            placeholder="https://yourbrand.com/shop"
            disabled={pending}
            className="h-10"
          />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canGenerate}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-foreground px-5 text-[13.5px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="size-4" />
          {pending ? "Generating your ad…" : "Generate preview"}
        </button>
        {pending && (
          <p className="text-center text-[11.5px] text-muted-foreground">
            This takes ~15 seconds. We're rendering one master image and
            cropping it for every Google placement.
          </p>
        )}
      </form>

      {/* Preview area */}
      {result && adContent && (
        <section className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[18px] font-semibold tracking-tight">
              Live preview
            </h2>
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              AI picked sector ·{" "}
              <span className="text-foreground">{result.meta.sector}</span>
              {" · "}
              <span className="text-foreground">{result.meta.packLabel}</span>
            </div>
          </div>

          <div className="mt-6 grid gap-6">
            <SearchSerpMockup content={adContent} />
            <DisplayBannerMockup content={adContent} />
            <DiscoverCardMockup content={adContent} />
          </div>

          <p className="mt-6 text-[12px] text-muted-foreground">
            Like what you see? Continue to the full wizard to set budget,
            audience, and launch — or generate another variation by editing
            the brief above.
          </p>
        </section>
      )}
    </div>
  );
}
