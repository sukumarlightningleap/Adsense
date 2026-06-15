import { cn } from "@/lib/utils";

/**
 * Brand mark — a confident geometric "A" inside a rounded square.
 * Color follows currentColor so it inverts cleanly on dark sections.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
    >
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path
        d="M7.5 17 L12 6.5 L16.5 17 M9.5 13.5 L14.5 13.5"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoLockup({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight",
        className,
      )}
    >
      <LogoMark className="text-foreground" />
      <span className="text-[15px]">Adsense</span>
    </span>
  );
}
