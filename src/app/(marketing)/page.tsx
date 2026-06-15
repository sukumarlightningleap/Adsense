import { Hero } from "@/components/marketing/hero";
import { Stats } from "@/components/marketing/stats";
import { Features } from "@/components/marketing/features";
import { Workflow } from "@/components/marketing/workflow";
import { CTA } from "@/components/marketing/cta";

export default function Page() {
  return (
    <>
      <Hero />
      <Stats />
      <Features />
      <Workflow />
      <CTA />
    </>
  );
}
