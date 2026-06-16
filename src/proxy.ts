/**
 * Next.js 16 proxy — runs on every matched request before it hits the
 * route handler / page. (In Next 15 and earlier this file was called
 * `middleware.ts`; Next 16 renamed it to `proxy.ts`.)
 *
 * Uses ONLY the Edge-safe auth config (no DB, no bcrypt). The proxy
 * decodes the JWT cookie, runs `authorized()` from `auth.config.ts`, and
 * either lets the request through, redirects to `/sign-in`, or 302s to
 * `/app` if an already-signed-in user hits `/sign-in`.
 */
import NextAuth from "next-auth";

import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

// Next.js detects `default` function exports cleanly — keeps things explicit.
export default auth;

// Match every path EXCEPT:
//   - /api/auth/*       (NextAuth's own internal endpoints)
//   - /_next/*          (Next assets)
//   - static files      (favicon, .png, .svg, .ico)
// Everything else hits the authorized() check — it short-circuits to
// `return true` for public pages (e.g. `/`), so the cost is negligible.
export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.svg$|.*\\.ico$).*)",
  ],
};
