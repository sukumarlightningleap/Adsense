/**
 * Edge-safe NextAuth config — shared between the middleware (Edge runtime)
 * and the full server config (Node runtime).
 *
 * Why split? The middleware runs in the Edge runtime, which can't import
 * Node-only modules like `bcryptjs` or `pg` (which Prisma's Neon adapter
 * pulls in transitively). So:
 *
 *   - This file:  pages + callbacks.authorized + an empty providers list.
 *                 Imported by `src/middleware.ts` (Edge).
 *   - `auth.ts`:  full config — Credentials provider + DB calls + bcrypt +
 *                 jwt/session callbacks. Imported by route handlers and
 *                 server components (Node).
 *
 * This is the pattern NextAuth v5's docs recommend for credentials auth.
 */
import type { NextAuthConfig } from "next-auth";

const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    /**
     * Gate every request. Runs in middleware (Edge). Only thing that's
     * available is the request URL and the (already-decoded) JWT session.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnApp = nextUrl.pathname.startsWith("/app");
      const isOnSignIn = nextUrl.pathname.startsWith("/sign-in");

      // Protected: every /app/* page requires a session.
      if (isOnApp) {
        return isLoggedIn; // false → NextAuth redirects to /sign-in
      }

      // Already authenticated? Don't bother showing the sign-in page —
      // bounce them straight into the app.
      if (isOnSignIn && isLoggedIn) {
        return Response.redirect(new URL("/app", nextUrl));
      }

      return true;
    },
  },
  // Populated in auth.ts (Node-only, needs DB + bcrypt).
  providers: [],
} satisfies NextAuthConfig;

export default authConfig;
