# Adsense — Autopilot Vision (Draft)

> **Status**: Discussion captured 2026-06-19. Not yet approved for implementation.
> **Implementation gate**: Awaits user sign-off + Gemini API key unblock.

---

## 1. The pivot

Adsense moves from **co-pilot** (we suggest, human approves) to **full autopilot** (we handle everything, customer never touches Google Ads UI).

Customer-facing promise:
> *"Sign up. Add your website + payment. We launch and optimize your ads. You watch the leads come in."*

Two customer types, same app:

| Type | Examples | Starting state |
|---|---|---|
| **New (greenfield)** | (none yet) | No Google Ads account, no tracking, no campaigns |
| **Existing** | Ballast Books, Blue Balloon Books | Has Google Ads, may have broken tracking, may have running campaigns |

---

## 2. Hybrid billing model (agreed direction)

| Client type | Spend billing | SaaS fee |
|---|---|---|
| **NEW** | Pre-pay wallet (Option C) — top up via Stripe, we draw down as Google bills our MCC | Stripe subscription, ~$99/mo |
| **EXISTING** | Per-account card on Google (Option B) — their existing billing stays untouched | Stripe subscription, ~$99/mo |

### Why the split works
- NEW clients are fully under our control (sub-account in our MCC) → wallet gives one bill, hard spend cap, simple UX
- EXISTING clients already own their Google Ads billing → don't disrupt finance/AP workflows; we just bolt our SaaS fee on top

### Wallet mechanics (new clients)
- Stripe charges card → credits Adsense wallet
- Daily cron ingests Google Ads spend (`metrics.cost_micros` via GAQL) → deducts from wallet
- Auto-pause campaigns when wallet hits $0
- Opt-in auto-top-up ("if balance < $50, charge card for $200")
- Low-balance alerts (email + SMS) at <$20 threshold
- Min top-up: $50; quick buttons: $200 / $500 / $1000

### Wallet risks (must mitigate)
1. **Float / cash flow** — keep 30-day reserve in business bank
2. **Regulatory** (RBI PPI / US money transmitter / EU e-money) — structure as "advance for services" not "deposit"; non-refundable after 60 days; convertible to subscription credit only. Lawyer review at scale
3. **Refunds** — 7-day refund window, then credit-only
4. **Reconciliation** — daily estimate vs monthly Google invoice; show "Wallet pending: $X" UX
5. **Tax accounting** — wallet balance = unearned revenue until consumed

### Per-card on existing (Ballast/Blue Balloon path)
- Zero billing touch from us
- They keep paying Google directly with their existing card
- We only charge Adsense subscription via Stripe
- No regulatory exposure, no float
- Tradeoff: we can't enforce spend cap; if they ghost on subscription, their ads keep running on their dime

---

## 3. Phase roadmap (proposed)

### Phase 7 — Onboarding + billing
- **7a**: Google OAuth + auto-create sub-account under Adsense MCC (for NEW path)
- **7b**: Stripe subscription (both paths) + Adsense Wallet (NEW path only)
- **7c**: AI campaign blueprint generator (Gemini-powered) — picks channel, budget split, audience, copy direction from business brief

### Phase 8 — Existing client onboarding (Ballast + Blue Balloon land here)
- **8a**: OAuth into existing Google Ads → audit account discovery
  - Inventory: campaigns, ad groups, conversion actions, audiences, customer lists
  - Tracking integrity check (Blue Balloon's broken-since-Aug-2025 case)
  - Performance scan (Ballast's 5 winners / 3 bleeders case)
- **8b**: Auto-create ConversionAction via API + generate gtag snippet for customer to paste (or auto-inject via tag manager if they grant access)
- **8c**: Hosted landing page templates at `<slug>.adsense.app` for clients without a converting site

### Phase 9 — CRM + lead handling
- Adsense Inbox (native lightweight CRM for new clients)
- HubSpot / Pipedrive / Zoho OAuth connectors (for existing clients with their own CRM)
- Enhanced Conversions / Offline Conversion Import — flow qualified leads back to Google for bid signal

### Phase 10 — Optimization engine
- Daily cron: pull metrics → AI analyzes → suggest changes
- Auto-apply mode (autopilot default) vs review-first mode (opt-in)
- Bid changes, budget reallocation, pausing bleeders, asset rotation

### Phase 11 — Reporting + alerts
- Weekly AI-written report (PDF + email)
- Multi-channel alerts (email, SMS, WhatsApp): low balance, spend anomaly, conversion drop, tracking break

---

## 4. Concrete first-cases (existing clients)

### Ballast Books
- Has 5 winning ad groups + 3 bleeding Branded ad groups
- Needs: Target CPA recommendation, pause/reallocate bleeders
- Goes on Phase 8a + Phase 10 (audit → optimize)
- Billing: existing card on their account; pays Adsense $99/mo

### Blue Balloon Books
- Conversion tracking broken since Aug 2025
- ~14,302 unattributed clicks
- Needs: Phase 8b (auto-create ConversionAction + gtag snippet)
- After tracking is fixed, runs through Phase 10 optimization
- Billing: existing card on their account; pays Adsense $99/mo

---

## 5. Open decisions (need user sign-off before Phase 7)

1. **MCC ownership** — do we already have a Google Ads MCC, or do we need to apply? (Application takes 1-3 weeks)
2. **Landing pages** — hosted by us at `<slug>.adsense.app`, or tag-inject conversion tracking into client's existing site?
3. **Default launch behavior** — autopilot launches immediately to Google, or stays PAUSED for first 24h with a notification?
4. **Pricing model** —
   - Flat $99/mo per account?
   - Tiered ($49 / $99 / $299 by spend volume)?
   - % of ad spend (e.g. 10% with $99 minimum)?
5. **Markup on ad spend (wallet)** — recommended: no markup, wallet $200 = $200 of Google spend; SaaS fee separate
6. **Refund policy** — 7-day full refund, then credit-only? Or other?
7. **Self-serve sign-up vs invite-only** — first cohort (Ballast/Blue Balloon) is invite. When do we open the floodgates?

---

## 6. Tech dependencies / unblockers

- **Gemini API key** — paid `AQ.Ab8RN6...` key currently returns `API_KEY_SERVICE_BLOCKED` on project `699666586487`. Team to unblock via GCP Console → Credentials → API restrictions (add Generative Language API). All content pipeline work can be built now and tested when unblocked
- **Google Ads MCC** — needed for NEW client sub-account auto-provisioning
- **Stripe account** — for both subscription billing and wallet top-ups
- **Domain `adsense.app`** (or alternative) — for hosted landing pages
- **OAuth scopes audit** — Google Ads scope, HubSpot OAuth, Pipedrive OAuth, Zoho OAuth

---

## 7. What we're building right now (this session)

**AI content creation pipeline** — the engine that turns a business brief into ready-to-launch ad content:
- Gemini text generation: headlines, long headlines, descriptions, business name
- Gemini image generation: marketing images, square marketing images, logo concepts
- Sharp post-processing: resize generated images into 5 Google Ads required sizes
- Wired into existing wizard so users can click "AI Generate" and populate the asset slots

This unblocks Phases 7c, 8c, and 10 (all of which depend on AI content generation). We build now, test when the API key is enabled.

---

## 8. Reference — current Adsense state (as of 2026-06-19)

Completed Phases 1-6:
- ✅ Auth (NextAuth credentials + Neon Postgres + Prisma)
- ✅ Dashboard (KPI tiles + trend chart, demo + live)
- ✅ Wizard (multi-step campaign creation)
- ✅ SEARCH launcher (Google Ads API v24)
- ✅ Asset library (sharp pipeline, 5 sizes auto-generated)
- ✅ PMAX adapter (bulk_mutate with temp resource IDs)
- ✅ Mobile polish pass
- ✅ Deployed to Vercel

Stack: Next.js 16, React 19, Tailwind v4, shadcn/ui (base-nova), Prisma 7 + Neon, NextAuth v5, Google Ads API v24, sharp, motion.

---

*End of draft. Update this file as decisions land.*
