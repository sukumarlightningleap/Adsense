"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  connectAccountAction,
  type ConnectAccountState,
} from "./actions";

const INITIAL: ConnectAccountState = { error: null };

export function ConnectAccountForm() {
  const [state, formAction, pending] = useActionState(
    connectAccountAction,
    INITIAL,
  );

  return (
    <form action={formAction} className="space-y-6">
      {/* Required */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="customerId" className="text-sm font-medium">
            Customer ID <span className="text-destructive">*</span>
          </Label>
          <Input
            id="customerId"
            name="customerId"
            required
            disabled={pending}
            placeholder="123-456-7890"
            inputMode="numeric"
            className="h-10 font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            The 10-digit ID from Google Ads (dashes optional).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="descriptiveName" className="text-sm font-medium">
            Account name
          </Label>
          <Input
            id="descriptiveName"
            name="descriptiveName"
            disabled={pending}
            placeholder="Client name or internal label"
            className="h-10"
          />
          <p className="text-[11px] text-muted-foreground">
            Optional. Used as the display name in lists.
          </p>
        </div>
      </div>

      {/* Optional */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Optional details
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="loginCustomerId" className="text-sm font-medium">
              MCC login ID
            </Label>
            <Input
              id="loginCustomerId"
              name="loginCustomerId"
              disabled={pending}
              placeholder="123-456-7890"
              inputMode="numeric"
              className="h-10 font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Only if accessed via an MCC.
            </p>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="currencyCode" className="text-sm font-medium">
              Currency
            </Label>
            <Input
              id="currencyCode"
              name="currencyCode"
              disabled={pending}
              placeholder="USD"
              maxLength={4}
              className="h-10"
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to USD.
            </p>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="timeZone" className="text-sm font-medium">
              Time zone
            </Label>
            <Input
              id="timeZone"
              name="timeZone"
              disabled={pending}
              placeholder="America/New_York"
              className="h-10"
            />
            <p className="text-[11px] text-muted-foreground">
              IANA tz name.
            </p>
          </div>
        </div>
      </div>

      {/* Note + submit */}
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">Note:</span> the
        connection isn&apos;t verified until your first campaign launch
        (Phase 3). Until then, this just records the account in your
        workspace.
      </div>

      {state.error && (
        <motion.div
          key={state.error}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive"
          role="alert"
        >
          {state.error}
        </motion.div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="h-10 px-5">
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Plus />
              Save account
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
