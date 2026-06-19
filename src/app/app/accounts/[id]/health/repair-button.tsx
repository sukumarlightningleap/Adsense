"use client";

/**
 * Repair-conversion-action button.
 *
 * Phase 8b v1: surfaces the gtag snippet for the broken conversion
 * action so the customer can paste it on their landing page (or hand it
 * to their dev). The snippet includes the Google Ads conversion ID +
 * conversion label placeholder — they fill the label from their Google
 * Ads UI (Goals → click action → Tag setup → Conversion label).
 *
 * Phase 8b.1 will add:
 *   - Auto-fetch the conversion label from Google's TagSnippetService
 *   - Google Tag Manager OAuth → auto-inject the snippet
 *   - Server-side "fire a test event" verifier
 */
import { useState, useTransition } from "react";
import { Check, ClipboardCopy, Wrench, X } from "lucide-react";

import { fetchSnippetAction } from "./repair-action";

type Snippet = {
  conversionId: string;
  customerId: string;
  /** The full gtag snippet, fully formed except for the conversion label. */
  gtagSnippet: string;
  noScriptSnippet: string;
};

export function RepairConversionButton({
  conversionId,
}: {
  conversionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"gtag" | "noscript" | null>(null);

  function onOpen() {
    setOpen(true);
    if (snippet) return;
    setError(null);
    startTransition(async () => {
      const res = await fetchSnippetAction(conversionId);
      if (!res.ok) setError(res.error);
      else setSnippet(res.snippet);
    });
  }

  function copy(kind: "gtag" | "noscript", text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-[11.5px] font-medium text-background transition-colors hover:bg-foreground/85"
      >
        <Wrench className="size-3.5" />
        Repair
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">
                  Repair conversion tracking
                </h3>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Paste this snippet on the page that should count as a
                  conversion (typically the thank-you page).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              {pending && (
                <p className="text-[12.5px] text-muted-foreground">
                  Loading snippet…
                </p>
              )}
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </p>
              )}
              {snippet && (
                <div className="space-y-5">
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-900">
                    <strong>Before pasting:</strong> in Google Ads, go to
                    Goals → Summary → click your conversion action → Tag
                    setup, and copy the <code>send_to</code> label. Replace{" "}
                    <code className="font-mono">YOUR_LABEL_HERE</code> in
                    the snippet below.
                  </div>

                  <CodeBlock
                    label="gtag.js (paste in <head>)"
                    text={snippet.gtagSnippet}
                    copied={copied === "gtag"}
                    onCopy={() => copy("gtag", snippet.gtagSnippet)}
                  />

                  <CodeBlock
                    label="No-JS fallback (optional, paste in <body>)"
                    text={snippet.noScriptSnippet}
                    copied={copied === "noscript"}
                    onCopy={() => copy("noscript", snippet.noScriptSnippet)}
                  />

                  <p className="text-[11.5px] text-muted-foreground">
                    Coming soon: connect Google Tag Manager and we&apos;ll
                    inject this automatically. For now, paste manually and
                    re-run the health check tomorrow.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CodeBlock({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-600" />
              Copied
            </>
          ) : (
            <>
              <ClipboardCopy className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-5">
        {text}
      </pre>
    </div>
  );
}
