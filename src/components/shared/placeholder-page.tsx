import { type LucideIcon } from "lucide-react";

/**
 * Placeholder for routes that don't have their real implementation yet
 * (e.g. /app/campaigns before Phase 2). Keeps navigation clickable without
 * landing the user on a 404.
 */
export function PlaceholderPage({
  icon: Icon,
  title,
  body,
  comingIn,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  comingIn: string;
}) {
  return (
    <div className="container-page py-16 md:py-20">
      <div className="max-w-2xl">
        <div className="inline-flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
          <Icon className="size-5" />
        </div>
        <h1 className="mt-6 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-pretty text-base leading-7 text-muted-foreground">
          {body}
        </p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider">
          <span className="size-1.5 rounded-full bg-brand" />
          {comingIn}
        </div>
      </div>
    </div>
  );
}
