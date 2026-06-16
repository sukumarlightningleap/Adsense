"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { LogoLockup } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

import { MarketingMobileMenu } from "./mobile-menu";

/**
 * Sticky marketing nav. Border + subtle backdrop blur fade in
 * after the user scrolls a bit — Linear/Vercel pattern.
 */
export function MarketingHeader() {
  const { scrollY } = useScroll();
  const borderOpacity = useTransform(scrollY, [0, 80], [0, 1]);
  const blurAmount = useTransform(scrollY, [0, 80], [0, 8]);
  const backdropFilter = useTransform(blurAmount, (b) => `blur(${b}px)`);

  return (
    <motion.header
      style={{ backdropFilter }}
      className="sticky top-0 z-50 w-full"
    >
      <motion.div
        style={{ opacity: borderOpacity }}
        className="absolute inset-x-0 bottom-0 h-px bg-border"
      />
      <div className="container-page flex h-14 items-center justify-between">
        <Link
          href="/"
          aria-label="Adsence home"
          className="flex items-center gap-2 -ml-1 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogoLockup />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-1 text-[13px] text-muted-foreground"
        >
          {site.nav.marketing.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {/* Sign in: hidden on the tightest screens (use the hamburger
              instead) so the header doesn't crowd. md+ shows it inline. */}
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/sign-in" />}
            className="hidden md:inline-flex"
          >
            Sign in
          </Button>
          <Button
            size="sm"
            render={<Link href="/sign-up" />}
            className="hidden sm:inline-flex"
          >
            Get started
          </Button>
          <MarketingMobileMenu />
        </div>
      </div>
    </motion.header>
  );
}
