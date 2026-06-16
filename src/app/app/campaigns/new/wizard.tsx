"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  emptyDraft,
  Step1Schema,
  Step2Schema,
  Step3Schema,
  Step4Schema,
  type CampaignDraft,
} from "@/lib/wizard/schema";

import { saveCampaignAction } from "./actions";
import { StepBook } from "./steps/step-book";
import { StepAudience } from "./steps/step-audience";
import { StepCopy } from "./steps/step-copy";
import { StepBudget } from "./steps/step-budget";
import { StepReview } from "./steps/step-review";

export type AccountOption = {
  id: string;
  name: string;
  customerId: string;
  currencyCode: string;
};

const LS_KEY = "adsense-campaign-wizard-draft-v1";

const STEPS = [
  { title: "Product", subtitle: "What you're advertising" },
  { title: "Audience", subtitle: "Where and to whom" },
  { title: "Ad copy", subtitle: "Headlines, descriptions, keywords" },
  { title: "Budget", subtitle: "Spend + bidding" },
  { title: "Review", subtitle: "Preview + save" },
] as const;

type ValidationResult = { ok: true } | { ok: false; message: string };

function validateStep(step: number, draft: CampaignDraft): ValidationResult {
  let parsed;
  switch (step) {
    case 0:
      parsed = Step1Schema.safeParse(draft);
      break;
    case 1:
      parsed = Step2Schema.safeParse(draft);
      break;
    case 2:
      parsed = Step3Schema.safeParse(draft);
      break;
    case 3:
      parsed = Step4Schema.safeParse(draft);
      break;
    default:
      return { ok: true };
  }
  if (parsed.success) return { ok: true };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    message: first?.message ?? "Invalid step",
  };
}

export function Wizard({ accounts }: { accounts: AccountOption[] }) {
  const [draft, setDraft] = useState<CampaignDraft>(() => {
    const start = emptyDraft();
    if (accounts.length > 0) start.accountId = accounts[0]!.id;
    return start;
  });
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ---- localStorage backup ---------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { step: number; draft: CampaignDraft };
      if (parsed.draft && typeof parsed.step === "number") {
        setDraft(parsed.draft);
        setStep(parsed.step);
      }
    } catch {
      /* corrupt cache — ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ step, draft }));
    } catch {
      /* quota — silent */
    }
  }, [step, draft]);

  // ---- navigation ------------------------------------------------------
  function goNext() {
    const validation = validateStep(step, draft);
    if (!validation.ok) {
      setStepError(validation.message);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  function handleSubmit() {
    setSubmitError(null);
    // Final pre-submit validation (each per-step schema).
    for (let i = 0; i < 4; i++) {
      const v = validateStep(i, draft);
      if (!v.ok) {
        setStep(i);
        setStepError(v.message);
        return;
      }
    }
    startTransition(async () => {
      try {
        const result = await saveCampaignAction(draft);
        if (!result.ok) {
          setSubmitError(result.error);
          return;
        }
        // Success: clear localStorage. The server action redirects, so
        // we won't reach the next line in practice.
        localStorage.removeItem(LS_KEY);
      } catch (e) {
        // Next's redirect() throws — that's not a real error.
        // Other errors get surfaced.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("NEXT_REDIRECT")) return;
        setSubmitError(msg);
      }
    });
  }

  function handleReset() {
    if (
      !window.confirm(
        "Discard your draft and start over? Your saved progress in this browser will be cleared.",
      )
    ) {
      return;
    }
    localStorage.removeItem(LS_KEY);
    const fresh = emptyDraft();
    if (accounts.length > 0) fresh.accountId = accounts[0]!.id;
    setDraft(fresh);
    setStep(0);
    setStepError(null);
    setSubmitError(null);
  }

  return (
    <div>
      {/* Progress bar */}
      <Progress current={step} />

      {/* Step body */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
              {STEPS[step]!.title}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {STEPS[step]!.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Reset draft
          </button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && (
              <StepBook
                accounts={accounts}
                draft={draft}
                onChange={setDraft}
              />
            )}
            {step === 1 && <StepAudience draft={draft} onChange={setDraft} />}
            {step === 2 && <StepCopy draft={draft} onChange={setDraft} />}
            {step === 3 && <StepBudget draft={draft} onChange={setDraft} />}
            {step === 4 && (
              <StepReview
                accounts={accounts}
                draft={draft}
                error={submitError}
                pending={pending}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Step-validation error */}
        {stepError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[13px] text-destructive"
            role="alert"
          >
            {stepError}
          </motion.div>
        )}

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={step === 0 || pending}
          >
            <ArrowLeft />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext} disabled={pending}>
              Continue
              <ArrowRight />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Save as draft
                  <ArrowRight />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1 sm:gap-2">
      {STEPS.map((s, i) => {
        const state =
          i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li
            key={s.title}
            className="flex flex-1 items-center gap-1.5 sm:gap-2"
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[10px] font-semibold",
                state === "done" &&
                  "border-brand bg-brand text-brand-foreground",
                state === "active" &&
                  "border-foreground bg-foreground text-background",
                state === "todo" &&
                  "border-border bg-background text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            {/* Labels hidden on small screens to keep the bar uncluttered */}
            <span
              className={cn(
                "hidden truncate text-[12px] font-medium sm:inline",
                state === "active"
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {s.title}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px flex-1 transition-colors",
                  i < current ? "bg-brand" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
