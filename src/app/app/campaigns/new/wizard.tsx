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
  Step5AssetsSchema,
  type CampaignDraft,
  type Channel,
} from "@/lib/wizard/schema";

import { saveCampaignAction } from "./actions";
import { StepBook } from "./steps/step-book";
import { StepAudience } from "./steps/step-audience";
import { StepCopy } from "./steps/step-copy";
import { StepBudget } from "./steps/step-budget";
import { StepAssets, type LibraryAsset } from "./steps/step-assets";
import { StepReview } from "./steps/step-review";

export type AccountOption = {
  id: string;
  name: string;
  customerId: string;
  currencyCode: string;
};

const LS_KEY = "adsense-campaign-wizard-draft-v2"; // bumped — schema changed

type StepDef = {
  /** Stable string ID so localStorage / validateStep don't depend on index. */
  id: "product" | "audience" | "copy" | "budget" | "assets" | "review";
  title: string;
  subtitle: string;
};

const SEARCH_STEPS: StepDef[] = [
  { id: "product", title: "Product", subtitle: "Channel + product details" },
  { id: "audience", title: "Audience", subtitle: "Where and to whom" },
  { id: "copy", title: "Ad copy", subtitle: "Headlines, descriptions, keywords" },
  { id: "budget", title: "Budget", subtitle: "Spend + bidding" },
  { id: "review", title: "Review", subtitle: "Preview + save" },
];

const PMAX_STEPS: StepDef[] = [
  { id: "product", title: "Product", subtitle: "Channel + product details" },
  { id: "audience", title: "Audience", subtitle: "Where and to whom" },
  { id: "copy", title: "Ad copy", subtitle: "Headlines, descriptions, business name" },
  { id: "budget", title: "Budget", subtitle: "Spend + bidding" },
  { id: "assets", title: "Assets", subtitle: "Bind library images to PMAX roles" },
  { id: "review", title: "Review", subtitle: "Preview + save" },
];

function stepsFor(channel: Channel): StepDef[] {
  return channel === "PMAX" ? PMAX_STEPS : SEARCH_STEPS;
}

type ValidationResult = { ok: true } | { ok: false; message: string };

function validateStep(
  stepId: StepDef["id"],
  draft: CampaignDraft,
): ValidationResult {
  let parsed;
  switch (stepId) {
    case "product":
      parsed = Step1Schema.safeParse(draft);
      break;
    case "audience":
      parsed = Step2Schema.safeParse(draft);
      break;
    case "copy":
      parsed = Step3Schema.safeParse(draft);
      break;
    case "budget":
      parsed = Step4Schema.safeParse(draft);
      break;
    case "assets":
      parsed = Step5AssetsSchema.safeParse(draft);
      break;
    case "review":
      return { ok: true };
  }
  if (parsed.success) return { ok: true };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    message: first?.message ?? "Invalid step",
  };
}

export function Wizard({
  accounts,
  library,
}: {
  accounts: AccountOption[];
  library: LibraryAsset[];
}) {
  const [draft, setDraft] = useState<CampaignDraft>(() => {
    const start = emptyDraft();
    if (accounts.length > 0) start.accountId = accounts[0]!.id;
    return start;
  });
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const steps = stepsFor(draft.channel);
  // Clamp step on channel change (SEARCH has 5 steps, PMAX has 6).
  const safeStep = Math.min(step, steps.length - 1);
  const currentStepDef = steps[safeStep]!;

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
      localStorage.setItem(LS_KEY, JSON.stringify({ step: safeStep, draft }));
    } catch {
      /* quota — silent */
    }
  }, [safeStep, draft]);

  // ---- navigation ------------------------------------------------------
  function goNext() {
    const validation = validateStep(currentStepDef.id, draft);
    if (!validation.ok) {
      setStepError(validation.message);
      return;
    }
    setStepError(null);
    setStep(Math.min(safeStep + 1, steps.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep(Math.max(safeStep - 1, 0));
  }

  function handleSubmit() {
    setSubmitError(null);
    // Final pre-submit validation across every step EXCEPT review.
    for (const s of steps) {
      if (s.id === "review") continue;
      const v = validateStep(s.id, draft);
      if (!v.ok) {
        const idx = steps.findIndex((x) => x.id === s.id);
        setStep(idx);
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
        localStorage.removeItem(LS_KEY);
      } catch (e) {
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

  const isLast = safeStep === steps.length - 1;

  return (
    <div>
      <Progress current={safeStep} steps={steps} />

      <div className="mt-8 rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Step {safeStep + 1} of {steps.length} · {draft.channel}
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
              {currentStepDef.title}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {currentStepDef.subtitle}
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
            key={`${draft.channel}-${currentStepDef.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {currentStepDef.id === "product" && (
              <StepBook
                accounts={accounts}
                draft={draft}
                onChange={setDraft}
              />
            )}
            {currentStepDef.id === "audience" && (
              <StepAudience draft={draft} onChange={setDraft} />
            )}
            {currentStepDef.id === "copy" && (
              <StepCopy draft={draft} onChange={setDraft} />
            )}
            {currentStepDef.id === "budget" && (
              <StepBudget draft={draft} onChange={setDraft} />
            )}
            {currentStepDef.id === "assets" && (
              <StepAssets
                draft={draft}
                onChange={setDraft}
                library={library}
              />
            )}
            {currentStepDef.id === "review" && (
              <StepReview
                accounts={accounts}
                draft={draft}
                error={submitError}
                pending={pending}
              />
            )}
          </motion.div>
        </AnimatePresence>

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

        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={safeStep === 0 || pending}
          >
            <ArrowLeft />
            Back
          </Button>
          {!isLast ? (
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

function Progress({
  current,
  steps,
}: {
  current: number;
  steps: StepDef[];
}) {
  return (
    <ol className="flex items-center gap-1 sm:gap-2">
      {steps.map((s, i) => {
        const state =
          i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li
            key={s.id}
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
            {i < steps.length - 1 && (
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
