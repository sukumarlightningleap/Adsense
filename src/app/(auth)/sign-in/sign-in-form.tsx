"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signInAction, type SignInState } from "./actions";

const initialSignInState: SignInState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialSignInState,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-5">
      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          placeholder="you@company.com"
          aria-invalid={!!state.error}
          className="h-11 text-[15px]"
        />
      </div>

      {/* Password — with show/hide + forgot link */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <Link
            href="/forgot-password"
            className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-brand"
            tabIndex={pending ? -1 : 0}
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={pending}
            aria-invalid={!!state.error}
            className="h-11 pr-11 text-[15px]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            disabled={pending}
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Error — shakes once on appearance */}
      {state.error && (
        <motion.div
          key={state.error}
          initial={{ opacity: 0, y: -6, x: 0 }}
          animate={{
            opacity: 1,
            y: 0,
            x: [0, -4, 4, -3, 3, -2, 2, 0],
          }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive"
          role="alert"
        >
          {state.error}
        </motion.div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={pending}
        className="h-11 w-full text-sm"
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            Sign in
            <ArrowUpRight />
          </>
        )}
      </Button>
    </form>
  );
}
