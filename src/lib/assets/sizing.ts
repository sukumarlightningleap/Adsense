/**
 * Google Ads image-size pipeline.
 *
 * Every uploaded image is resized into the variants Google Ads needs at
 * launch time. For marketing images: 3 dimensions. For logos: 2.
 *
 * Implementation uses `sharp` (`libvips` under the hood — fast, low
 * memory, handles PNG/JPEG/WebP/AVIF input transparently). Crops via
 * `fit: cover` to preserve the focal area; edges may be trimmed.
 */
import { createHash } from "node:crypto";

import sharp from "sharp";

import type { AssetRole } from "@/lib/ads/types";

export type GoogleAdsSize = {
  /** Human-readable label (e.g. "Landscape 1.91:1"). */
  name: string;
  width: number;
  height: number;
  /** Role the variant will fill on a campaign asset. */
  role: AssetRole;
  /** Whether this size is for logos (vs marketing imagery). */
  isLogo: boolean;
};

/**
 * The five Google Ads sizes Adsense generates today. Logo sizes only
 * fire for `isLogo` uploads; marketing sizes fire for everything else.
 *
 * Sources for the dimensions:
 *   - Marketing image (1200×628): landscape — 1.91:1
 *   - Marketing image (1200×1200): square — 1:1
 *   - Marketing image (960×1200): portrait — 4:5
 *   - Square logo (1200×1200): 1:1
 *   - Landscape logo (1200×300): 4:1
 */
export const GOOGLE_ADS_SIZES: GoogleAdsSize[] = [
  {
    name: "Landscape · 1.91:1",
    width: 1200,
    height: 628,
    role: "marketing_image",
    isLogo: false,
  },
  {
    name: "Square · 1:1",
    width: 1200,
    height: 1200,
    role: "square_marketing_image",
    isLogo: false,
  },
  {
    name: "Portrait · 4:5",
    width: 960,
    height: 1200,
    role: "portrait_marketing_image",
    isLogo: false,
  },
  {
    name: "Square logo · 1:1",
    width: 1200,
    height: 1200,
    role: "square_logo",
    isLogo: true,
  },
  {
    name: "Landscape logo · 4:1",
    width: 1200,
    height: 300,
    role: "landscape_logo",
    isLogo: true,
  },
];

export type ResizedVariant = {
  size: GoogleAdsSize;
  bytes: Buffer;
  /** sha256 of the resized output — used to dedup if the same crop
   *  has been generated before. */
  sha256: string;
};

/**
 * Read width/height from the source image without re-encoding. Used to
 * stamp dimensions on the original Asset row.
 */
export async function readDimensions(
  bytes: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes).metadata();
    if (meta.width && meta.height) {
      return { width: meta.width, height: meta.height };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate the Google Ads variant set for an upload.
 *
 *   - opts.isLogo = true → 2 logo variants (square + landscape)
 *   - opts.isLogo = false → 3 marketing-image variants
 *
 * All variants are emitted as PNG (lossless, transparent-bg safe). We
 * could swap to WebP for a ~30% size reduction; Google Ads accepts
 * both. PNG keeps things predictable for now.
 */
export async function resizeForGoogleAds(
  src: Buffer,
  opts: { isLogo: boolean },
): Promise<ResizedVariant[]> {
  const sizes = GOOGLE_ADS_SIZES.filter((s) => s.isLogo === opts.isLogo);

  const results: ResizedVariant[] = [];
  for (const size of sizes) {
    const buf = await sharp(src)
      .resize(size.width, size.height, {
        fit: "cover", // crop to fill — preserves aspect, may trim edges
        position: "center",
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    results.push({
      size,
      bytes: buf,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }
  return results;
}
