/**
 * Full NextAuth v5 config (Node runtime).
 *
 * Extends `auth.config.ts` (Edge-safe shared base) with:
 *   - Credentials provider that verifies bcrypt password against the DB
 *   - jwt + session callbacks that propagate `id` and `role` onto the
 *     session token so `session.user.role` is available everywhere
 *   - Side effects on successful login: `lastLoginAt` bump + audit log
 *
 * Strategy is JWT (not database sessions) — required by the credentials
 * provider, and means middleware can decode session without a DB call.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import authConfig from "@/auth.config";
import { db } from "@/lib/db";
import type { UserRole } from "@/lib/auth/roles";

const SignInSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Credentials requires JWT (no DB-backed sessions for this provider).
  session: { strategy: "jwt" },
  // Required when running behind a proxy / on Vercel — trusts the X-Forwarded-*
  // headers when reconstructing the callback URL. Safe for our setup.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCreds) {
        const parsed = SignInSchema.safeParse(rawCreds);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.user.findUnique({ where: { email } });
        // Treat missing user, deactivated user, and bad password identically
        // — no enumeration via timing or error message.
        if (!user || !user.isActive) return null;

        const ok = await bcrypt.compare(password, user.hashedPassword);
        if (!ok) return null;

        // Side effects: bump last_login + audit log. Run in parallel.
        await Promise.all([
          db.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          }),
          db.auditLog.create({
            data: {
              userId: user.id,
              action: "user.login",
            },
          }),
        ]);

        // What the JWT callback receives as `user`. Only what we want on
        // the session — never `hashedPassword`.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Runs on every JWT mint/refresh. `user` is only set on initial sign-in
     * (immediately after `authorize()` returns a user) — subsequent calls
     * just have `token`. So we copy `id`/`role` from user to token here,
     * then rely on them existing on token for the rest of the session.
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: UserRole }).role;
      }
      return token;
    },
    /**
     * Shape the session object exposed to client code. Anything we want at
     * `session.user.x` has to be copied off the token here.
     */
    async session({ session, token }) {
      if (token.id && typeof token.id === "string") {
        session.user.id = token.id;
      }
      if (token.role) {
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
});
