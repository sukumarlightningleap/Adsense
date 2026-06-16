import { getDemoStats } from "@/lib/demo/seeder";

import { DemoControls } from "./demo-controls";

export const metadata = {
  title: "Demo data",
};

export default async function AdminDemoPage() {
  const stats = await getDemoStats();

  return (
    <div className="container-page py-12 md:py-16">
      <header className="max-w-3xl">
        <div className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          — Admin · Demo data
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Demo data
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-[15px] leading-7 text-muted-foreground">
          Adsense ships with a believable demo dataset so prospects, sales
          reviews, and demo users can browse the product without touching
          real Google Ads accounts. Demo data is org-wide — every demo user
          sees the same set.
        </p>
      </header>

      {/* Current stats */}
      <section className="mt-10">
        <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Current dataset
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Accounts" value={stats.accounts} />
          <StatTile label="Campaigns" value={stats.campaigns} />
          <StatTile label="Daily KPI rows" value={stats.dailyKpis} />
          <StatTile label="Assets" value={stats.assets} />
        </div>
      </section>

      {/* Controls */}
      <section className="mt-10">
        <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Controls
        </div>
        <div className="mt-4">
          <DemoControls />
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
        {value.toLocaleString("en-US")}
      </div>
    </div>
  );
}
