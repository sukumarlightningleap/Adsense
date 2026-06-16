import Link from "next/link";
import { ArrowUpRight, Database, Users } from "lucide-react";

import { db } from "@/lib/db";

export const metadata = {
  title: "Admin",
};

export default async function AdminLanding() {
  // Quick at-a-glance counts so the admin sees the workspace's shape
  // before drilling in.
  const [userCount, demoAccountCount, demoCampaignCount] = await Promise.all([
    db.user.count(),
    db.adsAccount.count({ where: { demoMode: true } }),
    db.campaign.count({ where: { demoMode: true } }),
  ]);

  return (
    <div className="container-page py-12 md:py-16">
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          <span className="size-1 rounded-full bg-brand" />
          Admin
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Workspace admin
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
          Manage users and the demo dataset. Member and demo users
          don&apos;t see this section.
        </p>
      </header>

      <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <AdminCard
          href="/app/admin/users"
          icon={<Users className="size-5" />}
          title="Users"
          subtitle={`${userCount} active`}
          body="Create members and demo logins. Deactivate accounts when staff leave. Every change is audit-logged."
        />
        <AdminCard
          href="/app/admin/demo"
          icon={<Database className="size-5" />}
          title="Demo data"
          subtitle={`${demoAccountCount} accounts · ${demoCampaignCount} campaigns`}
          body="Seed a believable demo dataset for prospect demos and demo user logins. Reset wipes it cleanly."
        />
      </section>
    </div>
  );
}

function AdminCard({
  href,
  icon,
  title,
  subtitle,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-7 transition-shadow hover:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.15)]"
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
          {icon}
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
      <div className="mt-5 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {subtitle}
        </span>
      </div>
      <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
        {body}
      </p>
    </Link>
  );
}
