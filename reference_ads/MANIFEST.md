# Reference Ads — Manifest (v2)

Hand-categorized inventory of the 43 Google Ads screenshots in this folder. Feeds the `vision-ingest` module: per-file attributes here become the seed metadata when each image is run through Gemini Vision to build sector Style Packs.

**Captured:** 2026-06-19 from Google Ads Transparency Center
**Total files:** 43

---

## 0 · Critical scope rule — what we control vs. Google chrome

Every Transparency Center screenshot wraps the actual ad creative in Google's chrome. We must not learn from chrome.

```
┌─────────────────────────────────────────────┐
│  ⚪ Brand Logo · brand.com           ⋮      │  ← GOOGLE CHROME (auto)
├─────────────────────────────────────────────┤
│                                             │
│         [ IMAGE CANVAS ]                    │  ← WE GENERATE THIS
│                                             │
├─────────────────────────────────────────────┤
│  Headline text                              │  ← GOOGLE renders from
│  Description text                           │     our TEXT assets
│  [ Visit Site ]                             │  ← GOOGLE chrome (auto)
├─────────────────────────────────────────────┤
│  See more ads by this advertiser →          │  ← GOOGLE chrome (auto)
└─────────────────────────────────────────────┘
```

What the pipeline owns: **the image canvas, nothing else.** No CTAs, no advertiser logos as text, no blue "Visit Site" buttons. The vision-ingest module strips chrome before sending anything to Gemini Vision.

---

## 1 · Two creative modes (the architect's first decision)

Every ad in the set falls into one of two modes. The architect picks one per campaign based on the brief — neither is the "default."

### MODE 1 · CLEAN-IMAGE
Photography or illustration only. **No text inside the image.** Google layers our headline / description / CTA around it. This is the standard PMAX `marketing_image` / `square_marketing_image` shape.

Best for:
- Product categories (e-commerce, fashion, books)
- Service categories (plumbing, handyman, legal)
- Clean SaaS / B2B
- When the brand has strong product photography or screenshots

### MODE 2 · DESIGNED-CREATIVE
A full poster with the headline / brand color / sometimes wordmark baked **into** the image. The image IS the ad.

Best for:
- Subscriptions / brand-led campaigns (Skillshare, Robinhood, Everand)
- Promotional / discount campaigns (Blinkist Black Friday)
- Premium / heritage products (Hachette Bible)
- Identity-heavy advertisers where brand recall > product showcase

---

## 2 · Files by mode

| Mode | Count | Files |
|---|---|---|
| **MODE 1 · Clean-image** | 22 | 16-24-13, 16-24-51, 16-27-14, 16-26-27, 16-27-45, 16-30-07, 16-30-15, 16-30-27, 16-30-47, 16-31-30, 16-33-07, 16-34-01, 16-35-58, 16-36-21, 16-36-42, 16-37-33, 16-37-50, 16-38-12, 16-39-03, 16-39-36, 16-42-53, 16-43-43, 16-45-40 |
| **MODE 2 · Designed-creative** | 20 | 16-23-06, 16-23-14, 16-23-22, 16-24-05, 16-28-44, 16-28-48, 16-28-52, 16-32-11, 16-33-00, 16-33-12, 16-33-29, 16-41-00, 16-41-54, 16-42-07, 16-42-22, 16-43-18, 16-44-12, 16-46-06, 16-46-19 |

(The split is close to 50/50 — both modes are equally important.)

---

## 3 · Techniques worth stealing — by sector

Each row is a specific *move* the pipeline's architect can name and reuse. Drawn from every sector in the set, not just the most-represented one.

| From | Mode | Technique to steal |
|---|---|---|
| **Publishing — book cover hero** | 1 | Single book on solid-color square block (teal, yellow, orange). Book occupies ~50% of canvas, centered. Strong color contrast between book and background |
| **Publishing — audiobook campaigns** | 2 | Multi-cover grid (2x3 or 3x2) under a serif headline ("Rewind Time", "Hear History Come Alive"). Soft pastel or warm-cream background |
| **Publishing — premium / Bible** | 2 | Dark moody photography of physical book + serif white text overlay. Heritage / luxury cue |
| **Religious / personal** | 1 | Flatlay composition (book + coffee + cloth) shot from above on natural texture |
| **Audible Shopping cards** | 1 | Book cover only, on white, no background design. Pure product showcase |
| **Subscription reading apps** | 2 | Bold headline left, illustrated character or branded gradient right. Yellow/orange chip for offer ("Read & listen FREE for 30 days") |
| **Blinkist / promotional** | 2 | Dark background + small product thumbnails strip + giant offer text ("85% OFF") + brand-color accent |
| **Notion / SaaS** | 1 | Cream/neutral background + one bold accent shape (red half-circle, illustrated arrow) + product UI screenshot |
| **Thumbtack / services** | 1 | Tight close-up of *hands doing the work* (wrench on pipe, pen on paper). Photographic, slight depth-of-field |
| **Wayfair / home goods** | 1 | Product placed in a fully-styled room scene (not on white). Surrounding context sells the lifestyle |
| **Allbirds / apparel** | 1 | Product on pure white, 3/4 angle, brand wordmark as small caption below |
| **Skillshare brand panels** | 2 | Saturated single-color background (orange, cyan) + bold sans headline + accent squiggle line. Brand wordmark top-left |
| **Skillshare lesson cards** | 2 | Course art + instructor face + course title baked in, with brand mark and rating badge |
| **Robinhood Crypto / Legend** | 2 | Lime-green saturated background + serif sans headline + product UI screenshot tilted slightly |
| **Hachette / premium photo** | 2 | Dark green/cream photo of physical objects + white serif overlay text. "Art Meets Scripture" elegance |
| **Everand / subscription gradient** | 2 | Dark gradient (purple→black or purple→yellow) + book trio + bold headline. Mood-led, not product-led |
| **CarWise / auto urgency** | 2 | Dark gradient + person standing by car + checkbox-list of benefits + offer chip |
| **Native ad with brown strip** (LAYOUT-E-style) | 1 | Standard photo with merchant strip. The strip is template chrome — we just supply the photo |

---

## 4 · Color palettes by sector

Single dominant brand color + neutrals is the universal rule. No rainbow palettes in the set.

| Palette family | Sectors that use it | Files |
|---|---|---|
| **White / light-gray (default)** | E-commerce, shopping, services, B2B SaaS | 16-30-*, 16-34-01, 16-35-58, 16-36-*, 16-37-*, 16-38-12, 16-39-03/36 |
| **Purple / pink** | Audiobooks, romance subscriptions | 16-23-06, 16-23-14, 16-33-29 |
| **Warm yellow / orange / cream** | Education, lifestyle books, autumn-history | 16-23-22, 16-24-05, 16-24-51, 16-26-27, 16-42-22 |
| **Green / forest / nature** | Religious / heritage, eco / habits books | 16-24-51, 16-27-45, 16-28-* |
| **Teal / cyan** | Crime fiction, Skillshare brand | 16-24-13, 16-43-18 |
| **Lime / electric** | Fintech high-energy | 16-46-06, 16-46-19 |
| **Dark gradient + accent** | Premium subscriptions, urgency offers | 16-32-11, 16-33-29, 16-44-12 |

---

## 5 · Per-file inventory

> `[Mode]` 1 = clean-image · 2 = designed-creative
> `[Pal]` dominant color family
> Technique = the specific move from §3 to reuse

| File | Advertiser | Mode | Pal | Technique |
|---|---|---|---|---|
| 16-23-06 | Penguin RH Audio | 2 | Purple | Multi-cover grid + serif headline |
| 16-23-14 | Penguin RH Audio | 2 | Purple | Multi-cover grid + serif headline |
| 16-23-22 | Penguin RH Audio | 2 | Cream | Multi-cover grid + serif headline (warm) |
| 16-24-05 | Penguin RH Audio | 2 | Cream | Multi-cover grid + serif headline (warm, compact) |
| 16-24-13 | Penguin RH | 1 | Teal | Single book on solid-color block |
| 16-24-51 | Penguin RH (Avery) | 1 | Yellow/green | Single book on solid-color block |
| 16-26-27 | Penguin RH | 1 | Orange | Single book on solid-color block (small) |
| 16-27-14 | Harper Voyager | 1 | Orange-rust | Single book on solid-color block |
| 16-27-45 | Emily Wilson Hussem | 1 | Green-cream | Flatlay (book + coffee + cloth) |
| 16-28-44 | Hachette | 2 | Dark green | Dark moody photo + white serif overlay |
| 16-28-48 | Hachette | 1 | Cream-brown | Premium photo of opened book |
| 16-28-52 | Hachette | 2 | Dark green | Dark moody photo + white serif overlay |
| 16-30-07 | Audible | 1 | White | Shopping card — book cover on white |
| 16-30-15 | Audible | 1 | White | Shopping card — book cover on white |
| 16-30-27 | Audible | 1 | White | Shopping card — book cover on white |
| 16-30-47 | Audible | 1 | White | Shopping card — book cover on white |
| 16-31-30 | Audible | 1 | White | Shopping card — book cover on white |
| 16-32-11 | Blinkist | 2 | Dark + green | Dark BG + thumbnails + giant offer text |
| 16-33-00 | Everand | 2 | White + yellow | Bold left headline + illustration right + offer chip |
| 16-33-07 | Everand | 1 | White | Lifestyle photo (books + headphones) |
| 16-33-12 | Everand | 2 | Cyan-gradient | Phone with app + book grid + headline overlay |
| 16-33-29 | Everand | 2 | Dark purple | Dark gradient + book trio + bold headline |
| 16-34-01 | Notion | 1 | Cream + red accent | Cream BG + accent shape + product UI screenshot |
| 16-35-58 | Thumbtack | 1 | White | Hands-doing-work close-up (wrench on pipe) |
| 16-36-21 | Thumbtack | 1 | White | 2-up before/after interior photos |
| 16-36-42 | Thumbtack | 1 | White | Hands-doing-work close-up (pen on paper) |
| 16-37-33 | Wayfair | 1 | White | Product in styled room scene (lamp) |
| 16-37-50 | Wayfair | 1 | White | Product in styled patio scene (chair) |
| 16-38-12 | Wayfair | 1 | White | Product in styled interior (pet bed + dog) |
| 16-39-03 | Allbirds | 1 | White | Product on pure white, 3/4 angle |
| 16-39-36 | Allbirds | 1 | White | Product on pure white + wordmark caption |
| 16-41-00 | ArtMasterClass | 2 | Brown | Photo + native merchant strip |
| 16-41-54 | Skillshare | 2 | White + accents | Lesson card — course art + instructor + title |
| 16-42-07 | Skillshare | 2 | Multi | Lesson card — instructor face + course title |
| 16-42-22 | Skillshare | 2 | Orange-yellow | Brand panel + bold sans headline + squiggle |
| 16-42-53 | Skillshare | 1 | Multi | Top-down lifestyle photo (hands + supplies) |
| 16-43-18 | Skillshare | 2 | Cyan | Brand panel + bold sans headline + paint splash |
| 16-43-43 | WiseTime / Clio | 1 | White | 2-up portraits, business-native style |
| 16-44-12 | CarWise Peoria | 2 | Dark + red | Dark gradient + person + benefits list + offer |
| 16-45-40 | Revolution Event Design | 1 | Warm-brown | Photo + native merchant strip |
| 16-46-06 | Robinhood Crypto | 2 | Lime | Lime panel + serif headline + phone UI |
| 16-46-19 | Robinhood Legend | 2 | Lime | Lime panel + serif headline + UI screenshot |

---

## 6 · Design rules — only the ones WE control

(Stripped of everything Google's chrome handles: CTA button, advertiser logo bar, headline rendering below the image, "See more ads" chip.)

1. **One saturated brand color + neutrals.** Never rainbow.
2. **In MODE 1 (clean-image)**: subject occupies 40-60% of canvas, centered or rule-of-thirds. Background is neutral or single-color block. Keep important elements within the inner 60% so sharp's center-crop to 1.91:1 / 4:5 doesn't lose the focal point.
3. **In MODE 2 (designed-creative)**: text occupies 20-40% of canvas. ONE headline (≤8 words). Sans for modern / mass-market; serif for premium / heritage. White text on dark BG, dark text on bright BG.
4. **Photography vs illustration**: photo for commerce + services + premium. Illustration for abstract offerings (subscription value props, SaaS concepts).
5. **No brand wordmark as the main subject.** Google adds the advertiser identity bar separately. Wordmarks in the canvas are accent-only (small, corner, low-prominence).
6. **No CTAs in the image canvas.** Google renders the button.
7. **Sector-specific photographic style** (from §3): commerce = product-in-scene, services = hands-doing-work, premium = dark moody, subscriptions = brand-color panel.

---

## 7 · How `vision-ingest` consumes this

1. **Chrome-strip pre-pass**: tell Gemini Vision explicitly to ignore the chrome (advertiser bar, headline, CTA, "See more" chip) and analyze only the image canvas. We don't need pixel-perfect cropping — the prompt is the guardrail.
2. **For each file**, send (image + manifest row from §5) to Gemini Vision with this ask:
   > "Confirm or correct the mode, palette, and technique. Then extract:
   >   - hex palette (primary, secondary, accent)
   >   - composition (1 sentence on subject placement)
   >   - mood (3-5 adjectives)
   >   - photographicStyle ('photo' / 'illustration' / 'mixed')
   >   - if mode=designed-creative: textOnCanvas details (font weight, word count, placement)
   >
   > IGNORE everything outside the image canvas — advertiser bar, headline below, CTA button, 'See more' chip."
3. **Validated rows are upserted** into `style-packs.json`, keyed by `id` (e.g. `publishing-book-on-color-block`).
4. **At generation time**, the architect picks the best-matching style pack for the brief and embeds its attributes (palette hexes, composition rule, technique sentence) into the master prompt before calling the image model.
5. **Customer-uploaded reference images** run through the same `ingestReferenceAd()` call and become an ad-hoc style pack scoped to that one campaign.

---

*End of manifest. Update §5 as you add or remove reference files.*
