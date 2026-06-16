"use client";

import { useActionState, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  resetDemoAction,
  seedDemoAction,
  type DemoActionState,
} from "./actions";

const INITIAL: DemoActionState = { error: null, message: null };

export function DemoControls() {
  const [seedState, seedFormAction, seedPending] = useActionState(
    seedDemoAction,
    INITIAL,
  );
  const [resetState, resetFormAction, resetPending] = useActionState(
    resetDemoAction,
    INITIAL,
  );
  const [resetArmed, setResetArmed] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Seed */}
      <div className="flex flex-col rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <Sparkles className="size-4" />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Idempotent
          </span>
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight">
          Seed demo data
        </h3>
        <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
          Wipes existing demo rows, then creates a fresh org-wide dataset:
          3 accounts, 5–8 campaigns each, 90 days of KPIs, image assets.
        </p>
        <form action={seedFormAction} className="mt-5">
          <Button
            type="submit"
            disabled={seedPending || resetPending}
            className="h-10 px-4"
          >
            {seedPending ? (
              <>
                <Loader2 className="animate-spin" />
                Seeding…
              </>
            ) : (
              <>
                <Sparkles />
                Seed demo data
              </>
            )}
          </Button>
        </form>
        <ActionResult state={seedState} />
      </div>

      {/* Reset */}
      <div className="flex flex-col rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <RotateCcw className="size-4" />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-destructive/70">
            Destructive
          </span>
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight">
          Reset demo data
        </h3>
        <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
          Deletes every demo account, campaign, KPI, and asset. Real data is
          untouched. Requires a second click to confirm.
        </p>
        <form action={resetFormAction} className="mt-5 flex items-center gap-2">
          {resetArmed ? (
            <>
              <Button
                type="submit"
                variant="destructive"
                disabled={resetPending || seedPending}
                className="h-10 px-4"
              >
                {resetPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Wiping…
                  </>
                ) : (
                  "Confirm reset"
                )}
              </Button>
              <button
                type="button"
                onClick={() => setResetArmed(false)}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setResetArmed(true)}
              disabled={resetPending || seedPending}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-4 text-[13px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="size-4" />
              Reset demo data
            </button>
          )}
        </form>
        <ActionResult state={resetState} />
      </div>
    </div>
  );
}

function ActionResult({ state }: { state: DemoActionState }) {
  if (state.error) {
    return (
      <motion.div
        key={state.error}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-4 rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[12px] text-destructive"
        role="alert"
      >
        {state.error}
      </motion.div>
    );
  }
  if (state.message) {
    return (
      <motion.div
        key={state.message}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-4 flex items-start gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[12px] text-emerald-700"
        role="status"
      >
        <CheckCircle2 className="size-3.5 shrink-0 mt-px" />
        <span>{state.message}</span>
      </motion.div>
    );
  }
  return null;
}
