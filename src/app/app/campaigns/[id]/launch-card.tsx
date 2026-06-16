"use client";

import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { launchCampaignAction, type LaunchActionResult } from "./launch-action";

type Props = {
  campaignId: string;
  /** Active credential profile from env. Used purely for the badge. */
  profile: "test" | "prod";
  /** Daily-budget cap from env — shown in the safety strip. */
  maxDailyUsd: number;
  /** Already launched? Show the success state and link to Google's UI. */
  alreadyLaunched: {
    providerCampaignId: string;
    profile: "test" | "prod" | null;
    launchedAt: Date | null;
  } | null;
  /** Daily budget on the campaign — to flag if it exceeds the cap. */
  dailyUsd: number | null;
};

export function LaunchCard({
  campaignId,
  profile,
  maxDailyUsd,
  alreadyLaunched,
  dailyUsd,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<LaunchActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function fire() {
    setResult(null);
    startTransition(async () => {
      const r = await launchCampaignAction(campaignId, true);
      setResult(r);
    });
  }

  if (alreadyLaunched) {
    return (
      <AlreadyLaunched
        providerCampaignId={alreadyLaunched.providerCampaignId}
        profile={alreadyLaunched.profile}
        launchedAt={alreadyLaunched.launchedAt}
      />
    );
  }

  const budgetOverCap = dailyUsd != null && dailyUsd > maxDailyUsd;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border px-6 py-4",
          profile === "prod" ? "bg-destructive/[0.04]" : "bg-brand/[0.04]",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-xl",
              profile === "prod"
                ? "bg-destructive text-destructive-foreground"
                : "bg-brand text-brand-foreground",
            )}
          >
            <Rocket className="size-4" />
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">
              Launch to Google Ads
            </div>
            <div className="text-[12px] text-muted-foreground">
              Pushes a paused copy. You enable it from Google&apos;s UI.
            </div>
          </div>
        </div>
        <ProfileBadge profile={profile} />
      </div>

      {/* Body */}
      <div className="space-y-5 p-6">
        {/* Safety strip */}
        <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
          <Check label={`Campaign will be created as PAUSED on Google.`} />
          <Check
            label={`Daily budget cap: $${maxDailyUsd} (LAUNCHER_MAX_DAILY_USD).`}
            warn={budgetOverCap}
          />
          <Check
            label={
              profile === "test"
                ? "Active credential profile is TEST — safe to retry."
                : "Active credential profile is PROD — real money."
            }
            warn={profile === "prod"}
          />
        </ul>

        {/* Result */}
        {result && !result.ok && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive"
            role="alert"
          >
            <div className="font-medium">
              Launch failed · {result.code}
            </div>
            <div className="mt-1 text-[12px] opacity-90">
              {result.message}
            </div>
          </motion.div>
        )}

        {result?.ok && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 text-[13px] text-emerald-700"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <div className="font-medium">
                Launched on {result.profile.toUpperCase()}
              </div>
              <div className="mt-1 font-mono text-[11px]">
                provider_campaign_id = {result.providerCampaignId}
              </div>
              <div className="font-mono text-[11px]">
                {result.resourceName}
              </div>
              <div className="mt-2 text-[12px] text-emerald-700/80">
                Refresh the page to see the recorded launch state.
              </div>
            </div>
          </motion.div>
        )}

        {/* Confirm + launch */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={pending}
              className="size-4 rounded border-border accent-foreground"
            />
            I&apos;ve reviewed the campaign and want to push it to Google.
          </label>
          <Button
            type="button"
            disabled={!confirmed || pending || budgetOverCap}
            onClick={fire}
            className={cn(
              "h-10 px-5",
              profile === "prod" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/80",
            )}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" />
                Launching…
              </>
            ) : (
              <>
                <Rocket />
                Launch now
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AlreadyLaunched({
  providerCampaignId,
  profile,
  launchedAt,
}: {
  providerCampaignId: string;
  profile: "test" | "prod" | null;
  launchedAt: Date | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-emerald-500/[0.04] px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
            <CheckCircle2 className="size-4" />
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">
              Already launched to Google Ads
            </div>
            <div className="text-[12px] text-muted-foreground">
              The campaign lives on Google. Manage it from there.
            </div>
          </div>
        </div>
        {profile && <ProfileBadge profile={profile} />}
      </div>
      <div className="space-y-2 p-6 text-[13px]">
        <Row
          label="Provider campaign ID"
          value={providerCampaignId}
          mono
        />
        {launchedAt && (
          <Row
            label="Launched at"
            value={launchedAt.toISOString().replace("T", " ").slice(0, 16)}
            mono
          />
        )}
        <p className="text-[12px] text-muted-foreground">
          Re-launching from Adsense isn&apos;t supported in Phase 4 — edit
          on Google&apos;s side, or create a new draft to push a fresh one.
        </p>
      </div>
    </div>
  );
}

function Check({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <li
      className={cn(
        "flex items-start gap-1.5",
        warn ? "text-amber-700" : "text-muted-foreground",
      )}
    >
      {warn ? (
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
      )}
      {label}
    </li>
  );
}

function ProfileBadge({ profile }: { profile: "test" | "prod" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
        profile === "test"
          ? "border-brand/40 bg-brand/10 text-brand"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          profile === "test" ? "bg-brand" : "bg-destructive",
        )}
      />
      {profile}
    </span>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-[12.5px] font-medium", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
