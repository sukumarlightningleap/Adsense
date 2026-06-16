"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X } from "lucide-react";

import { LogoLockup } from "@/components/shared/logo";
import { site } from "@/lib/site";

/**
 * Marketing-page mobile menu. A hamburger button that opens a full-screen
 * overlay with the same nav links the desktop header shows.
 *
 * Sign in is moved here on mobile to keep the top bar uncluttered while
 * still being one tap away.
 */
export function MarketingMobileMenu() {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the menu is open.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted md:hidden"
      >
        <Menu className="size-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] flex flex-col bg-background md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-6">
              <LogoLockup />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>

            <motion.nav
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.2 }}
              className="flex-1 overflow-y-auto px-6 py-6"
            >
              <ul className="space-y-1">
                {site.nav.marketing.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-lg px-2 py-3 text-lg font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.nav>

            <div className="border-t border-border p-6 space-y-3">
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="block w-full rounded-lg border border-border bg-background py-3 text-center text-[14px] font-medium transition-colors hover:bg-muted"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                onClick={() => setOpen(false)}
                className="block w-full rounded-lg bg-foreground py-3 text-center text-[14px] font-medium text-background transition-colors hover:bg-foreground/80"
              >
                Get started
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
