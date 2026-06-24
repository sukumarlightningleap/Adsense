# Handoff — Phases 3 & 4 (theme unification + preview polish)

**Written:** 2026-06-24 after completing Phases 1 & 2 of the create-flow UX overhaul.
**Read this entire file before touching anything.** It's the context dump.

---

## 1. Why this handoff exists

The previous session completed Phases 1 and 2 of a UX overhaul:

- ✅ **Phase 1:** Sidebar auto-hides on `/app/create` and `/app/campaigns/[id]` for a wider workspace. Floating menu button restores it.
- ✅ **Phase 2:** Create Campaign refactored from a 2,500-line single scroll into a **5-step wizard** (Brief → Copy → Images → Targeting → Review & Launch) with top stepper + bottom Next/Back nav. Auto-advance to Step 2 after generation. Per-step Next-gate validation.

Phases 3 and 4 were deferred to a fresh session to keep context windows lean.

---

## 2. Project at a glance (skim if you're new)

- **Stack:** Next.js 16 App Router + React 19 + Tailwind v4 + shadcn/ui + Prisma 7 + Neon Postgres + Google Ads API v24
- **Working dir:** `/home/sukumar-poddar/LLA_Projects/sh/Google_Ads_NextJS/`
- **Routes:**
  - `(marketing)/` — public landing (light theme, polished)
  - `(auth)/` — sign-in / forgot password
  - `app/` — protected workspace (currently has its own theming)
- **Active env:** `GOOGLE_ADS_PROFILE=test` (sandbox — safe for end-to-end testing)
- **Dev command:** `npm run dev -- -p 3001`
- **Verified working today:** PMax campaign Provider ID `23958804477` live in test MCC `573-102-1190` → `LLA Test Client`

---

## 3. Phase 3 — Theme unification (apply landing-page design to entire app)

### Goal
Match the look of the landing page across all post-login pages. Light theme everywhere, consistent colors / fonts / spacing / shadows / radii. Currently the app shell uses its own utilitarian Tailwind defaults and feels disconnected from the polished marketing pages.

### Why this matters
- Brand cohesion landing → app
- Reduces cognitive switching cost for the user
- User explicitly asked: *"whatever design or themes have you used for generating landing page, it was good, so i want it should be applicable on inside also"*

### Key files to audit FIRST (read before editing)

| File | Purpose |
|---|---|
| `src/app/(marketing)/page.tsx` | Landing page entry point |
| `src/app/(marketing)/layout.tsx` | Landing layout wrapper |
| `src/components/marketing/**` | Landing components (look for hero, features, footer) |
| `src/components/shared/logo.tsx` | LogoLockup — already shared |
| `src/app/globals.css` | Tailwind base + CSS variables (the theme tokens live here) |
| `src/app/app/layout.tsx` | Protected app shell |
| `src/app/app/_components/sidebar.tsx` | Desktop + mobile nav |
| `src/app/app/_components/app-shell-client.tsx` | (created in Phase 1) controls sidebar visibility |
| `tailwind.config.ts` or postcss config | Tailwind v4 config — may have custom colors |

### Suggested approach

1. **Audit landing-page design tokens** (15 min)
   - Open `(marketing)/page.tsx` and the components it composes
   - Note: dominant colors (likely emerald / mint green based on LL brand), font families, spacing rhythm, radii, shadows, button styles, card styles
   - You could also drop a screenshot of the landing page into `vision-ingest` for an automated extraction — same pattern used for the 42 reference ads

2. **Compare with app shell** (15 min)
   - Open `app/layout.tsx` + `_components/sidebar.tsx`
   - Compare colors, font sizes, button treatments
   - List specific deltas

3. **Unify in CSS variables** (30 min)
   - The CSS variables in `globals.css` are the single source of truth in Tailwind v4
   - Update tokens (`--background`, `--foreground`, `--primary`, `--card`, etc.) so landing + app share them
   - If landing uses Tailwind classes directly (no shared tokens), extract those to variables first

4. **Walk each app page** (1 hour)
   - `/app` (Overview) — `app/page.tsx`
   - `/app/create` (wizard — already redesigned in Phase 2)
   - `/app/campaigns` (list)
   - `/app/campaigns/[id]` (detail)
   - `/app/accounts`
   - `/app/accounts/[id]/conversion-tracking` (the Conversion Hub)
   - `/app/assets`
   - `/app/inbox`
   - `/app/settings`
   - `/app/admin/*`
   - Verify each renders correctly with the new tokens; fix mismatches

5. **Audit dark-mode behavior**
   - Check `globals.css` for any `.dark` token overrides
   - User asked for **light theme everywhere** — confirm there's no `prefers-color-scheme` flipping to dark on certain pages

### Estimated effort
2–3 hours of focused work. Theme touches every page so test thoroughly.

### Gotchas to watch
- The wizard Stepper component in `create-form.tsx` uses `bg-foreground text-background` for the active pill — check that contrast still works in the new palette
- The PMax launch button uses `bg-foreground` too — same check
- shadcn/ui components in `src/components/ui/` use Tailwind v4 semantic tokens — should auto-update if tokens are unified

---

## 4. Phase 4 — Preview polish (make the Live Preview rail amazing)

### Goal
The right-rail live preview on `/app/create` should look like a real Google Ad placement, polished enough that the user smiles when they see it. Currently it renders 3 simple mockups (SEARCH SERP, Display banner, Discover card) but the visuals are basic.

### User quote
> "preview should be also good, so it should look like amazing, so user get impress"

### Key files

| File | Purpose |
|---|---|
| `src/app/app/create/mockups.tsx` | The three mock components (`SearchSerpMockup`, `DisplayBannerMockup`, `DiscoverCardMockup`) |
| `src/app/app/create/create-form.tsx` (search for `PreviewRail`) | The rail itself — tabbed UI that swaps between mockups |
| `src/app/app/create/create-form.tsx` (search for `MOCKUPS` or look for `<aside className="lg:sticky lg:top-8 lg:self-start">`) | Where the rail is mounted in the wizard |

### Suggested improvements

| Idea | Effort | Impact |
|---|---|---|
| Pixel-accurate Google SERP frame (proper search box, ad badge, sitelinks) | 30 min | Realism |
| Real device frames around mockups (phone bezel for Discover, browser chrome for Display) | 45 min | Polish |
| Subtle fade/scale transitions when text/image updates | 20 min | Delight |
| Show ALL 3 mockups in a stacked stack (no tabs) so user sees everything at once | 30 min | Density |
| Live "Headline 1 / Headline 2 / Headline 3" cycling animation showing how Google rotates assets | 45 min | Educational |
| Add Performance Max storefront mockup (right now we only show Display) | 30 min | Coverage |
| Add a "screenshot this ad" share button (download as PNG via `html-to-image`) | 30 min | Demo magic |

### Lighter touch — quick polish wins (~1 hour total)
- Add subtle shadow + rounded corners to the mockup containers
- Drop in real Google fonts (`next/font` for Roboto / Google Sans)
- Add a tiny "AD" badge in the right spot per format
- Replace the gray placeholder gradients with real lifestyle backgrounds

### Estimated effort
1–2 hours for the lighter polish path. 3+ hours if going full pixel-accurate.

---

## 5. Things NOT to touch (recently shipped — let them bake)

- `src/lib/google-ads/launcher.ts` — per-account OAuth fix; PMax verified live
- `src/lib/google-ads/adapter-pmax.ts` — image asset `name` field fix
- `src/lib/ai/architect.ts` — anti-trope rules + mode-aware prompts
- `src/lib/ai/style-packs.json` — 42 vision-extracted packs (don't overwrite)
- `src/app/app/_components/app-shell-client.tsx` — Phase 1 sidebar logic
- `src/app/app/create/create-form.tsx` wizard scaffolding (`WizardStepper`, `WizardNav`, `canAdvanceFromStep`, `currentStep` state) — Phase 2

If you need to edit any of these, read the surrounding comments first — they explain why each is the way it is.

---

## 6. How to start the new session

Paste this verbatim into the new Claude Code session:

```
I'm continuing work on the Adsense (Google Ads autopilot) app at
/home/sukumar-poddar/LLA_Projects/sh/Google_Ads_NextJS/.

Read docs/HANDOFF-PHASES-3-4.md before doing anything. It has the
full context — what's done, what's next, key files, gotchas.

I want to start with Phase 3 (theme unification). Begin with the
"Suggested approach" steps 1 and 2 in section 3 of that doc, then
show me what you've found before making any code changes.
```

That's enough — the new session reads the doc, gets full context, and proposes Phase 3 step-by-step.

---

## 7. Verification before declaring Phase 3 / 4 done

Open these and confirm each looks polished + on-brand:

- [ ] `/` (landing — baseline, should be unchanged)
- [ ] `/sign-in` and `/forgot-password`
- [ ] `/app` (Overview)
- [ ] `/app/create` (the wizard — all 5 steps)
- [ ] `/app/campaigns` (list)
- [ ] `/app/campaigns/[id]` (detail of any campaign)
- [ ] `/app/accounts`
- [ ] `/app/accounts/[id]/conversion-tracking`
- [ ] `/app/assets`
- [ ] `/app/inbox`
- [ ] `/app/settings`
- [ ] Live preview rail on `/app/create` (Search / Display / Discover tabs)

Run `npx tsc --noEmit` after each edit chunk — keep typecheck green.

---

## 8. Open questions to ask the user before starting Phase 3

1. Should sign-in / forgot-password also get the unified theme, or are those already on-brand?
2. Light theme everywhere — confirm dark mode is fully off (no system-preference flip)?
3. Phase 4 preview polish — full pixel-accurate Google UI, or lighter "looks great in screenshots" polish?

---

## 9. Today's verified state

- Test profile active (`GOOGLE_ADS_PROFILE=test`)
- 1 successful end-to-end PMax launch on Google Ads (Provider Campaign ID `23958804477`)
- `style-packs.json` has 42 vision-extracted packs (DO NOT overwrite — re-running `scripts/ingest-reference-ads.mjs --files X` overwrites the whole file; only run the full no-arg version if you want to refresh)
- Lightning Leap Analytics test brief produces images via the new architect prompts (anti-trope bans active)
- All work committed locally; not yet pushed to GitHub; not yet deployed to Vercel since the wizard refactor

---

## 10. GitHub + Vercel deployment context

### GitHub
- **Repo:** `sukumarlightningleap/Adsense` → https://github.com/sukumarlightningleap/Adsense
- **Branch:** `main` (linear; no PR workflow for solo work today)
- **Account:** `d.lightningleap@gmail.com` (same as Vercel)
- **Webhook:** **BROKEN** — pushes to `main` do NOT auto-trigger Vercel deploys.
  Until fixed, every deploy must go through `vercel --prod` from local.

### Vercel
- **Project:** linked locally (see `.vercel/project.json` if present)
- **Production URL:** https://adsense-cyan.vercel.app
- **Account:** `d.lightningleap@gmail.com`
- **Deploy command:** `vercel --prod` from the project root — bundles local
  tree and uploads. Takes ~90s.

### Environment variables on Vercel (already set unless noted)

| Key | Notes |
|---|---|
| `DATABASE_URL` | Neon Postgres |
| `AUTH_SECRET` | NextAuth |
| `NEXT_PUBLIC_APP_URL` | `https://adsense-cyan.vercel.app` — must match for OAuth redirect URIs |
| `GOOGLE_ADS_PROFILE` | `test` |
| `GOOGLE_ADS_TEST_*` family | client_id / client_secret / developer_token / refresh_token / login_customer_id |
| `GOOGLE_ADS_*` family | Real-account variants — present but inactive while profile=test |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | 32-byte hex — AES key for per-account OAuth tokens |
| `HUBSPOT_*`, `PIPEDRIVE_*` | CRM OAuth client credentials |
| `GA4_OAUTH_CLIENT_*` | GA4 OAuth — same Google Cloud project as `GOOGLE_ADS_TEST_*` |
| `LAUNCHER_MAX_DAILY_USD` | Cap on daily budget for safety |
| **`GEMINI_API_KEY`** | AIza-prefix AI Studio key (old fallback) |
| **`GOOGLE_AGENT_PLATFORM_KEY`** | **NEW — needs to be set on Vercel.** AQ.-prefix Vertex AI Agent Platform express key. Takes precedence over GEMINI_API_KEY in gemini-client.ts auto-detect |

### Adding the new key to Vercel

The new session may need to walk the user through this:

```bash
# Interactive — prompts for value, then applies to production scope
vercel env add GOOGLE_AGENT_PLATFORM_KEY production

# Paste the AQ.* key when prompted, hit Enter, hit Enter again
# to skip optional metadata.
```

Then redeploy so the new env var loads:

```bash
vercel --prod
```

### Verification after deploy

1. Visit https://adsense-cyan.vercel.app — should load with new wizard
2. Sign in → `/app/create` → confirm sidebar auto-hides + 5-step wizard renders
3. Run an AI generation — confirm `GOOGLE_AGENT_PLATFORM_KEY` works in prod
   (look for the WiseTime SaaS palette / dashboard mockup, not generic AI brain)

---

*End of handoff. Run `/compact` in the current session before starting the new one to clear context cleanly.*
