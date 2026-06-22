/**
 * Manual mode for /app/create — bypasses all Gemini calls so we can
 * test the end-to-end Google Ads launch pipeline (PMax especially)
 * without burning AI quota.
 *
 * Drop hand-cropped image files into `public/manual-test-assets/` with
 * the filenames defined in MANUAL_ASSET_FILES below. The server action
 * `loadManualTestAssets` reads them at launch time, ingests each as an
 * Asset row (parent + Sharp-resized variants), and returns the asset
 * IDs the PMax adapter expects.
 *
 * Mock copy is a generic independent-bookstore brand ("Page & Quill
 * Books") tuned to satisfy Google's PMax minimums:
 *   - 5 short headlines (≤30 chars)
 *   - 3 long headlines (≤90 chars)
 *   - 3 descriptions (≤90 chars, at least one ≤60)
 *   - business name (≤25 chars)
 */
import type { PmaxAssetGroupCluster, ThemeCluster } from "@/lib/ai/types";

// ===========================================================================
// Brand / brief
// ===========================================================================

export const MANUAL_BRAND_NAME = "Page & Quill Books";

/**
 * Brand name with a short HH:mm:ss suffix so every manual-mode launch
 * produces a unique campaign name in Google Ads. Without this, retrying
 * a failed launch hits "campaign name already exists" because Google
 * keeps the partially-created campaign from the prior attempt.
 *
 * Format: "Page & Quill Books · 14:30:25"
 */
export function manualBrandNameWithSuffix(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${MANUAL_BRAND_NAME} · ${hh}:${mm}:${ss}`;
}

export const MANUAL_PRODUCT_DESCRIPTION =
  "Independent bookstore curating literary fiction, classic novels, and " +
  "curated bestsellers. We ship hand-picked monthly book bundles to " +
  "readers across the US. Target audience: book lovers 25-55 who want " +
  "thoughtful recommendations beyond Amazon's top-100 list.";

export const MANUAL_LANDING_URL = "https://www.penguinrandomhouse.com";

export const MANUAL_DEFAULT_BUDGET_USD = 5;

// ===========================================================================
// Mock copy — single PMAX asset group (satisfies Google's minimums)
// ===========================================================================

export const MANUAL_PMAX_CLUSTER: PmaxAssetGroupCluster = {
  themeLabel: "Curated Bestsellers",
  intent: "Bookstore browsers looking for thoughtful book recommendations",
  businessName: "Page & Quill",
  headlines: [
    "Books Hand-Picked Weekly",
    "Free Shipping on $35+",
    "Indie Bookstore Online",
    "Literary Fiction & More",
    "Monthly Reader Bundles",
  ],
  longHeadlines: [
    "Discover curated reads from an independent bookstore that loves literature",
    "Hand-selected monthly bundles delivered to your door, free shipping over $35",
    "Beyond bestseller lists — find your next favorite novel with us",
  ],
  // Google PMAX requires at least ONE description ≤60 chars
  // (`SHORT_DESCRIPTION_REQUIRED`). The first one below is 53 chars —
  // the others can run up to 90.
  descriptions: [
    "Indie bookstore. Curated picks. Free shipping $35+.",
    "Monthly book bundles, hand-picked by readers for readers. Cancel anytime.",
    "Browse literary fiction, classics, and modern favorites. Ship today.",
  ],
};

// ===========================================================================
// Mock SEARCH cluster (used only if user flips manual mode while on
// SEARCH — we still allow it). Keywords are intentionally bookstore-
// flavored.
// ===========================================================================

export const MANUAL_SEARCH_CLUSTER: ThemeCluster = {
  themeLabel: "Independent Bookstore",
  intent: "Searchers shopping for books from a non-Amazon retailer",
  headlines: [
    "Indie Bookstore Online",
    "Free Shipping on $35+",
    "Curated Book Bundles",
    "Hand-Picked Reads",
    "Books Shipped Today",
  ],
  descriptions: [
    "Independent bookstore. Hand-picked monthly bundles. Free shipping over $35.",
    "Curated literary fiction and classics — find your next favorite read.",
  ],
  keywords: [
    "independent bookstore online",
    "buy books online",
    "monthly book subscription",
    "curated book bundles",
    "indie bookstore shipping",
  ],
};

// ===========================================================================
// Image files — what the user must drop into public/manual-test-assets/
// ===========================================================================

export type ManualAssetSlot =
  | "logoSquare"
  | "logoLandscape"
  | "marketingLandscape"
  | "marketingSquare"
  | "marketingPortrait";

export type ManualAssetFileSpec = {
  slot: ManualAssetSlot;
  filename: string;
  isLogo: boolean;
  required: boolean;
  ratio: string;
  recommendedSize: string;
  label: string;
};

export const MANUAL_ASSET_FILES: ManualAssetFileSpec[] = [
  {
    slot: "logoSquare",
    filename: "logo-square.png",
    isLogo: true,
    required: true,
    ratio: "1:1",
    recommendedSize: "1200×1200",
    label: "Square logo",
  },
  {
    slot: "logoLandscape",
    filename: "logo-landscape.png",
    isLogo: true,
    required: false,
    ratio: "4:1",
    recommendedSize: "1200×300",
    label: "Landscape logo (optional)",
  },
  {
    slot: "marketingLandscape",
    filename: "marketing-landscape.png",
    isLogo: false,
    required: true,
    ratio: "1.91:1",
    recommendedSize: "1200×628",
    label: "Marketing landscape",
  },
  {
    slot: "marketingSquare",
    filename: "marketing-square.png",
    isLogo: false,
    required: true,
    ratio: "1:1",
    recommendedSize: "1200×1200",
    label: "Marketing square",
  },
  {
    slot: "marketingPortrait",
    filename: "marketing-portrait.png",
    isLogo: false,
    required: false,
    ratio: "4:5",
    recommendedSize: "960×1200",
    label: "Marketing portrait (optional)",
  },
];

export const MANUAL_ASSETS_DIR = "public/manual-test-assets";
