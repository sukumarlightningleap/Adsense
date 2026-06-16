"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type AccountOption = {
  id: string;
  name: string;
};

/**
 * Account filter for the campaigns list. Drives URL `?accountId=...` so
 * filter state survives reloads + can be shared via link.
 */
export function AccountFilter({
  accounts,
  currentAccountId,
}: {
  accounts: AccountOption[];
  currentAccountId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params);
    if (e.target.value) {
      next.set("accountId", e.target.value);
    } else {
      next.delete("accountId");
    }
    startTransition(() => {
      router.push(`/app/campaigns${next.toString() ? `?${next}` : ""}`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Account
      </span>
      <div className="relative">
        <select
          value={currentAccountId ?? ""}
          onChange={onChange}
          disabled={pending}
          className={cn(
            "h-9 rounded-md border border-border bg-background pl-3 pr-8 text-[13px] outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {pending && (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
