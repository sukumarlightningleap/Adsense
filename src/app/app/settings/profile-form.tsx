"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updateProfileAction, type SettingsState } from "./actions";

const INITIAL: SettingsState = { error: null, success: null };

export function ProfileForm({
  defaultName,
  email,
}: {
  defaultName: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    INITIAL,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="p-name" className="text-sm font-medium">
            Name
          </Label>
          <Input
            id="p-name"
            name="name"
            required
            defaultValue={defaultName}
            disabled={pending}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="p-email"
            value={email}
            disabled
            className="h-10 font-mono text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Email changes are managed by your administrator.
          </p>
        </div>
      </div>

      <Result state={state} />

      <Button type="submit" disabled={pending} className="h-10 px-4">
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <Save />
            Save profile
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
