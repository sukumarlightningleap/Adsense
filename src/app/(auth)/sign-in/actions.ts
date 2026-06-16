"use server";

/**
 * Server actions for the sign-in flow.
 *
 * Uses NextAuth's `signIn("credentials", ...)` which:
 *   1. Runs the `authorize()` callback in src/auth.ts (DB + bcrypt check)
 *   2. On success → mints a JWT, sets cookie, throws a NEXT_REDIRECT
 *      error that Next.js intercepts to navigate to `redirectTo`.
 *   3. On bad creds → throws AuthError("CredentialsSignin").
 *
 * The thrown-error pattern means we MUST re-throw any error that isn't an
 * AuthError (otherwise we swallow the NEXT_REDIRECT and the page stays put).
 */
import { AuthError } from "next-auth";

import { signIn } from "@/auth";

// Next 16 only allows ASYNC FUNCTION exports from `"use server"` files —
// no objects, no const literals. Type-only exports (erased at compile) are
// fine. The matching `initialSignInState` lives in `sign-in-form.tsx`.
export type SignInState = {
  error: string | null;
};

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/app",
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      // Don't leak which side (email vs password) was wrong.
      if (error.type === "CredentialsSignin") {
        return { error: "Email or password is incorrect." };
      }
      return { error: "We couldn't sign you in. Please try again." };
    }
    // NEXT_REDIRECT / NEXT_NOT_FOUND etc. — must propagate.
    throw error;
  }
}
