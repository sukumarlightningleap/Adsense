"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Layout for auth pages (/sign-in, /forgot-password).
 *
 * Visual elements:
 *   - Dotted-grid backdrop (matches the landing hero)
 *   - Two slow-drifting brand orbs (continuous, respects reduce-motion)
 *   - Soft radial mask that fades the grid at the edges
 *
 * All decorative; nothing here gates interaction.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();

  const drift = reduce
    ? undefined
    : { duration: 22, repeat: Infinity, ease: "linear" as const };

  return (
    <div className="relative flex-1 flex items-center justify-center overflow-hidden px-4 py-16">
      {/* Dotted grid backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-30 bg-grid-dotted mask-radial-fade opacity-50"
      />

      {/* Brand orb — top */}
      <motion.div
        aria-hidden
        className="absolute -top-32 left-1/2 -z-20 size-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)] blur-2xl"
        animate={
          reduce
            ? undefined
            : { x: ["-50%", "-40%", "-50%"], y: ["0%", "8%", "0%"] }
        }
        transition={drift}
      />

      {/* Brand orb — bottom counter-drift */}
      <motion.div
        aria-hidden
        className="absolute -bottom-40 right-1/4 -z-20 size-[420px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_14%,transparent),transparent)] blur-2xl"
        animate={
          reduce
            ? undefined
            : { x: ["0%", "-20%", "0%"], y: ["0%", "-10%", "0%"] }
        }
        transition={
          reduce
            ? undefined
            : { duration: 28, repeat: Infinity, ease: "linear" as const }
        }
      />

      {children}
    </div>
  );
}
