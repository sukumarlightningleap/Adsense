"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="relative overflow-hidden border-t border-border py-32 md:py-40">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-grid-dotted mask-radial-fade opacity-60"
      />
      <motion.div
        aria-hidden
        className="absolute inset-0 -z-20"
        animate={{
          background: [
            "radial-gradient(800px circle at 30% 20%, color-mix(in oklch, var(--brand) 14%, transparent), transparent 60%)",
            "radial-gradient(800px circle at 70% 30%, color-mix(in oklch, var(--brand) 14%, transparent), transparent 60%)",
            "radial-gradient(800px circle at 30% 20%, color-mix(in oklch, var(--brand) 14%, transparent), transparent 60%)",
          ],
        }}
        transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-15%" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="container-page text-center"
      >
        <h2 className="mx-auto max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.04em] md:text-7xl lg:text-8xl">
          Stop juggling tabs.
          <br />
          <span className="text-muted-foreground">
            Run Google Ads from one place.
          </span>
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-pretty text-lg text-muted-foreground md:text-xl">
          Start your free trial. No credit card. Cancel anytime.
        </p>
        <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            render={<Link href="/sign-up" />}
            className="h-12 px-7 text-base"
          >
            Get started
            <ArrowUpRight />
          </Button>
          <Button
            size="lg"
            variant="outline"
            render={<Link href="/contact" />}
            className="h-12 px-7 text-base"
          >
            Talk to us
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
