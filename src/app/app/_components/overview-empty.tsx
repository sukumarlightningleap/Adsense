import Link from "next/link";
import { Building2, Database } from "lucide-react";

import { Button } from "@/components/ui/button";

type Variant =
  | { variant: "live"; canConnect: boolean }
  | { variant: "demo"; canSeed: boolean };

/**
 * Empty-state hero shown on `/app` when there's nothing to render —
 * either because no live accounts are connected (live mode) or demo
 * data hasn't been seeded yet (demo mode).
 */
export function OverviewEmpty(props: Variant) {
  if (props.variant === "live") {
    return (
      <Card
        icon={<Building2 className="size-5" />}
        title="No Google Ads accounts yet"
        body="Connect your first Google Ads customer account to start seeing impressions, clicks, spend, and conversions here."
      >
        {props.canConnect && (
          <Button render={<Link href="/app/accounts/new" />}>
            Connect an account
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card
      icon={<Database className="size-5" />}
      title="Demo data hasn't been seeded"
      body="Demo data is org-wide. An admin needs to seed it from the Demo data page before anyone can browse the dashboard in demo mode."
    >
      {props.canSeed && (
        <Button render={<Link href="/app/admin/demo" />}>
          Seed demo data
        </Button>
      )}
    </Card>
  );
}

function Card({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center md:p-14">
      <div className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
        {icon}
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-muted-foreground">
        {body}
      </p>
      {children && <div className="mt-6 flex justify-center">{children}</div>}
    </div>
  );
}
