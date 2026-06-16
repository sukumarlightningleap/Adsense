"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createUserAction, type CreateUserState } from "./actions";

const INITIAL: CreateUserState = { error: null, success: null };

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createUserAction,
    INITIAL,
  );

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      // Use the success message as a key so the form re-renders fresh
      // (clearing inputs) on each successful create.
      key={state.success ?? "form"}
    >
      <div className="space-y-2 md:col-span-1">
        <Label htmlFor="cu-name" className="text-sm font-medium">
          Name
        </Label>
        <Input
          id="cu-name"
          name="name"
          required
          disabled={pending}
          placeholder="Jane Smith"
          className="h-10"
        />
      </div>

      <div className="space-y-2 md:col-span-1">
        <Label htmlFor="cu-email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="cu-email"
          name="email"
          type="email"
          required
          disabled={pending}
          placeholder="jane@company.com"
          className="h-10"
        />
      </div>

      <div className="space-y-2 md:col-span-1">
        <Label htmlFor="cu-role" className="text-sm font-medium">
          Role
        </Label>
        <select
          id="cu-role"
          name="role"
          required
          disabled={pending}
          defaultValue="member"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="member">Member</option>
          <option value="demo">Demo</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="space-y-2 md:col-span-1">
        <Label htmlFor="cu-password" className="text-sm font-medium">
          Initial password
        </Label>
        <Input
          id="cu-password"
          name="password"
          type="password"
          required
          minLength={8}
          disabled={pending}
          placeholder="At least 8 characters"
          className="h-10"
        />
      </div>

      <div className="md:col-span-2 flex items-center gap-3">
        <Button
          type="submit"
          disabled={pending}
          className="h-10 px-4"
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <Plus />
              Create user
            </>
          )}
        </Button>

        {state.error && (
          <motion.div
            key={state.error}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="text-[13px] text-destructive"
            role="alert"
          >
            {state.error}
          </motion.div>
        )}

        {state.success && (
          <motion.div
            key={state.success}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-1.5 text-[13px] text-emerald-600"
            role="status"
          >
            <CheckCircle2 className="size-3.5" />
            {state.success}
          </motion.div>
        )}
      </div>
    </form>
  );
}
