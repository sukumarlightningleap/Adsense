import { auth } from "@/auth";

export default async function AppHome() {
  const session = await auth();
  const user = session!.user;

  return (
    <div className="container-page py-16 md:py-20">
      <div className="max-w-3xl">
        <div className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          — Overview
        </div>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.025em] md:text-5xl">
          Welcome, {user.name?.split(" ")[0] ?? "there"}.
        </h1>
        <p className="mt-4 text-pretty text-base leading-7 text-muted-foreground md:text-lg">
          Signed in as{" "}
          <span className="font-medium text-foreground">{user.email}</span>{" "}
          (
          <span className="font-mono text-[12px] text-brand">{user.role}</span>
          ). The full overview lands in Phase 2 — for now, use the sidebar to
          jump around.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NextCard
            label="DAY 4 — NOW"
            title="Admin pages"
            body="Manage users and seed demo data from the sidebar (admin only)."
          />
          <NextCard
            label="PHASE 2"
            title="Accounts & campaigns"
            body="Connect Google Ads accounts and build the campaign create wizard."
          />
          <NextCard
            label="PHASE 3"
            title="TypeScript Google Ads adapter"
            body="Port the Python launcher to TS. Search → PMax → Display."
          />
          <NextCard
            label="PHASE 4"
            title="Image pipeline + conversion tracking"
            body="Nano-banana posters and per-account gtag snippet generator."
          />
        </div>
      </div>
    </div>
  );
}

function NextCard({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-[15px] font-semibold tracking-tight">
        {title}
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
