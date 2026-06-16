/**
 * TypeScript module augmentation — teaches the type system about the
 * extra fields we put on the session and JWT (`id`, `role`).
 *
 * Without this, `session.user.role` would be a TS error everywhere.
 */
import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/auth/roles";

declare module "next-auth" {
  /**
   * What `auth()` returns and what the client sees on the session.
   */
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  /**
   * Shape returned by `authorize()` in the Credentials provider.
   */
  interface User {
    id?: string;
    role?: UserRole;
  }
}

declare module "next-auth/jwt" {
  /**
   * What we stash on the JWT cookie between signin and session callbacks.
   */
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
