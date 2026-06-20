/**
 * Mock Google placements — pixel-approximate renders of the live
 * surfaces where this ad will eventually appear. NOT pixel-perfect;
 * close enough that the customer recognizes "oh, that's what it'll
 * look like on Google."
 *
 *   - <SearchSerpMockup>    — Sponsored result on a Search page
 *   - <DisplayBannerMockup> — 1:1 banner with overlay text
 *   - <DiscoverCardMockup>  — Google Discover feed card (mobile)
 */
import { MoreVertical, Search } from "lucide-react";

import { cn } from "@/lib/utils";

type AdContent = {
  brandName: string;
  landingDomain: string;
  headline: string;
  description: string;
  longHeadline?: string | null;
  /** Absolute or relative URL to the hero / square / logo asset bytes. */
  heroUrl?: string;
  squareUrl?: string;
  logoUrl?: string;
};

// ---------------------------------------------------------------------------
// 1) Sponsored Search result
// ---------------------------------------------------------------------------

export function SearchSerpMockup({ content }: { content: AdContent }) {
  const queryGuess = guessQuery(content.brandName);
  return (
    <MockupFrame label="Google Search · Sponsored">
      <div className="bg-white p-6">
        {/* Fake search bar */}
        <div className="flex items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
          <Search className="size-4 shrink-0 text-gray-400" />
          <span className="flex-1 truncate text-[13px] text-gray-700">
            {queryGuess}
          </span>
          <span className="text-[11px] font-mono text-gray-300">⏎</span>
        </div>

        {/* Sponsored result card */}
        <div className="mt-6 max-w-xl">
          <div className="text-[11px] font-semibold text-gray-900">
            Sponsored
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Avatar
              logoUrl={content.logoUrl}
              fallback={initials(content.brandName)}
              size={24}
            />
            <div className="leading-tight">
              <div className="text-[13.5px] font-medium text-gray-900">
                {content.brandName}
              </div>
              <div className="text-[12px] text-gray-600">
                {content.landingDomain}
              </div>
            </div>
          </div>
          <h3 className="mt-2 text-[19px] font-normal leading-snug text-[#1A0DAB] hover:underline">
            {content.headline}
          </h3>
          <p className="mt-1 text-[13.5px] leading-snug text-[#4D5156]">
            {content.description}
          </p>
        </div>
      </div>
    </MockupFrame>
  );
}

// ---------------------------------------------------------------------------
// 2) Display banner (square 1:1) — image dominant, overlay text
// ---------------------------------------------------------------------------

export function DisplayBannerMockup({ content }: { content: AdContent }) {
  return (
    <MockupFrame label="Google Display · 1:1 banner placement">
      <div className="grid place-items-center bg-gradient-to-br from-gray-100 to-gray-50 p-8">
        {/* Surrounding "host site" hint */}
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* The actual creative — square */}
          <div className="relative aspect-square w-full bg-gray-100">
            {content.squareUrl ? (
              <ImageOrFallback src={content.squareUrl} alt="Ad creative" />
            ) : (
              <FallbackTile label="Square 1:1 image" />
            )}

            {/* "Ad" chip — Google adds this overlay */}
            <span className="absolute right-2 top-2 rounded-sm bg-white/90 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-gray-700 shadow-sm">
              Ad
            </span>
          </div>

          {/* Google template adds copy + CTA below the image */}
          <div className="p-3">
            <div className="text-[12px] font-medium text-gray-900 line-clamp-2">
              {content.headline}
            </div>
            <p className="mt-1 text-[11.5px] text-gray-500 line-clamp-2">
              {content.description}
            </p>
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                {content.landingDomain}
              </span>
              <button
                type="button"
                disabled
                className="rounded-md bg-[#1A73E8] px-3 py-1 text-[11.5px] font-medium text-white"
              >
                Visit Site
              </button>
            </div>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ---------------------------------------------------------------------------
// 3) Discover card (mobile-feed style)
// ---------------------------------------------------------------------------

export function DiscoverCardMockup({ content }: { content: AdContent }) {
  return (
    <MockupFrame label="Google Discover · mobile feed card">
      <div className="grid place-items-center bg-gradient-to-b from-slate-100 to-slate-50 p-6 sm:p-10">
        {/* Phone frame */}
        <div className="relative w-full max-w-[300px] overflow-hidden rounded-[28px] border-[10px] border-slate-900 bg-white shadow-xl">
          {/* Status bar */}
          <div className="flex items-center justify-between bg-slate-50 px-5 py-1.5 text-[10px] font-medium text-slate-700">
            <span>9:41</span>
            <span className="font-mono">●●●●● 5G</span>
          </div>

          {/* Discover title */}
          <div className="px-4 pt-3 pb-2">
            <div className="text-[12px] font-medium text-slate-500">
              Discover · for you
            </div>
          </div>

          {/* Card */}
          <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* Hero image (1.91:1 landscape) */}
            <div className="relative aspect-[1.91/1] w-full bg-slate-100">
              {content.heroUrl ? (
                <ImageOrFallback
                  src={content.heroUrl}
                  alt="Ad hero"
                />
              ) : (
                <FallbackTile label="Hero 1.91:1" />
              )}
            </div>

            {/* Identity row */}
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <Avatar
                logoUrl={content.logoUrl}
                fallback={initials(content.brandName)}
                size={18}
              />
              <div className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                Sponsored · {content.brandName}
              </div>
              <MoreVertical className="size-3.5 shrink-0 text-slate-400" />
            </div>

            {/* Headline */}
            <h4 className="px-3 pt-1.5 text-[13.5px] font-semibold leading-snug text-slate-900">
              {content.longHeadline || content.headline}
            </h4>

            {/* Description */}
            <p className="px-3 pb-3 pt-1 text-[11.5px] leading-snug text-slate-600">
              {content.description}
            </p>

            {/* CTA */}
            <div className="border-t border-slate-100 px-3 py-2.5">
              <button
                type="button"
                disabled
                className="text-[12px] font-medium text-[#1A73E8]"
              >
                Visit Site →
              </button>
            </div>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function MockupFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function Avatar({
  logoUrl,
  fallback,
  size,
}: {
  logoUrl?: string;
  fallback: string;
  size: number;
}) {
  if (logoUrl) {
    return (
      <span
        className="inline-flex shrink-0 overflow-hidden rounded-full border border-gray-200 bg-white"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          className="size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-slate-200 font-mono font-semibold text-slate-600"
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
    >
      {fallback}
    </span>
  );
}

function ImageOrFallback({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="size-full object-cover" />
  );
}

function FallbackTile({ label }: { label: string }) {
  return (
    <div className="grid size-full place-items-center bg-gradient-to-br from-slate-100 to-slate-200">
      <div className={cn("font-mono text-[10px] text-slate-400")}>{label}</div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function guessQuery(brand: string): string {
  const lower = brand.toLowerCase();
  return lower.split(/\s+/).slice(0, 4).join(" ");
}
