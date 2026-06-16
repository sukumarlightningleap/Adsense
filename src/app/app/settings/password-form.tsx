"use client";

import { useActionState, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { changePasswordAction, type SettingsState } from "./actions";

const INITIAL: SettingsState = { error: null, success: null };

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    INITIAL,
  );
  const [showAll, setShowAll] = useState(false);

  return (
    // Reset inputs after a successful change.
    <form action={formAction} className="space-y-5" key={state.success ?? "p"}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="cp-current" className="text-sm font-medium">
            Current password
          </Label>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            tabIndex={-1}
          >
            {showAll ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {showAll ? "Hide" : "Show"}
          </button>
        </div>
        <Input
          id="cp-current"
          name="currentPassword"
          type={showAll ? "text" : "password"}
          autoComplete="current-password"
          required
          disabled={pending}
          className="h-10"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cp-new" className="text-sm font-medium">
            New password
          </Label>
          <Input
            id="cp-new"
            name="newPassword"
            type={showAll ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            disabled={pending}
            className="h-10"
          />
          <p className="text-[11px] text-muted-foreground">
            At least 8 characters.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cp-confirm" className="text-sm font-medium">
            Confirm new password
          </Label>
          <Input
            id="cp-confirm"
            name="confirmPassword"
            type={showAll ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            disabled={pending}
            className="h-10"
          />
        </div>
      </div>

      <Result state={state} />

      <Button type="submit" disabled={pending} className="h-10 px-4">
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Updating…
          </>
        ) : (
          <>
            <KeyRound />
            Change password
          </>
        )}
      </Button>
    </form>
  );
}

function Result({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <motion.div
        key={state.error}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[13px] text-destructive"
        role="alert"
      >
        {state.error}
      </motion.div>
    );
  }
  if (state.success) {
    return (
      <motion.div
        key={state.success}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[13px] text-emerald-700"
        role="status"
      >
        <CheckCircle2 className="mt-px size-3.5 shrink-0" />
        {state.success}
      </motion.div>
    );
  }
  return null;
}
