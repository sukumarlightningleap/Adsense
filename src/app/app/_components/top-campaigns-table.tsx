import { cn } from "@/lib/utils";
import type { TopCampaign } from "@/lib/dashboard/kpis";

export function TopCampaignsTable({ rows }: { rows: TopCampaign[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/60 px-5 py-10 text-center text-sm text-muted-foreground">
        No spend in the selected window yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/30 px-5 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <div className="col-span-5">Campaign</div>
        <div className="col-span-3">Account</div>
        <div className="col-span-1">Channel</div>
        <div className="col-span-1">Status</div>
        <div className="col-span-1 text-right">Clicks</div>
        <div className="col-span-1 text-right">Spend</div>
      </div>
      {rows.map((c) => (
        <div
          key={c.id}
          className="grid grid-cols-12 items-center gap-3 border-b border-border px-5 py-3 last:border-b-0 hover:bg-muted/30"
        >
          <div className="col-span-5 min-w-0 truncate text-[13.5px] font-medium">
            {c.name}
          </div>
          <div className="col-span-3 min-w-0 truncate text-[12px] text-muted-foreground">
            {c.accountName}
          </div>
          <div className="col-span-1">
            <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              {c.channelType}
            </span>
          </div>
          <div className="col-span-1">
            <StatusDot status={c.status} />
          </div>
          <div className="col-span-1 text-right font-mono text-[12px] tabular-nums">
            {c.clicks.toLocaleString("en-US")}
          </div>
          <div className="col-span-1 text-right font-mono text-[12px] font-medium tabular-nums">
            ${c.spendUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: TopCampaign["status"] }) {
  const colorMap: Record<TopCampaign["status"], string> = {
    ENABLED: "bg-emerald-500",
    PAUSED: "bg-amber-500",
    REMOVED: "bg-muted-foreground/40",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", colorMap[status])} />
      {status[0]}
      {status.slice(1).toLowerCase()}
    </span>
  );
}
