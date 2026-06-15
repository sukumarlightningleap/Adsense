/**
 * Single source of truth for brand strings. Renames + copy edits land here.
 * Brand name is intentionally a top-level constant so a rename (e.g. "Adsence"
 * → something else) is a one-file change.
 */
export const site = {
  name: "Adsense",
  tagline: "Google Ads operations, refined.",
  description:
    "Launch, measure, and optimize Google Ads campaigns from one dashboard. Built for agencies who need speed without losing control.",
  url: "https://adsense.app",
  twitter: "@adsense",
  nav: {
    marketing: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  footer: {
    company: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
    legal: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
    product: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
} as const;
