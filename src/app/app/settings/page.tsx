import { auth } from "@/auth";
import { db } from "@/lib/db";

import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await auth();
  const sessionUserId = session!.user.id;

  // Re-read from DB so profile name reflects any change made in this
  // session (the JWT cache lags behind until next sign-in).
  const user = await db.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  return (
    <div className="container-page py-12 md:py-16">
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          <span className="size-1 rounded-full bg-brand" />
          Settings
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Your account
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-7 text-muted-foreground">
          Manage your profile and password. Workspace-level settings come
          later when there&apos;s more than one user per workspace.
        </p>
      </header>

      {/* Profile */}
      <section className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Profile
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Display name &amp; email
            </h2>
          </div>
          {user?.role && (
            <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand">
              {user.role}
            </span>
          )}
        </div>
        <div className="mt-6">
          <ProfileForm
            defaultName={user?.name ?? ""}
            email={user?.email ?? ""}
          />
        </div>
      </section>

      {/* Security */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Security
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">
          Change password
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          We&apos;ll ask for your current password before saving a new one.
        </p>
        <div className="mt-6">
          <PasswordForm />
        </div>
      </section>

      {/* Meta */}
      {user && (
        <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <Meta label="Joined" value={user.createdAt.toISOString().slice(0, 10)} />
          <Meta
            label="Last sign-in"
            value={
              user.lastLoginAt
                ? `${user.lastLoginAt.toISOString().slice(0, 10)} ${user.lastLoginAt.toISOString().slice(11, 16)}`
                : "—"
            }
          />
          <Meta label="User ID" value={user.id.slice(0, 12) + "…"} mono />
        </section>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-[13px] ${mono ? "font-mono" : "font-medium"}`}
      >
        {value}
      </div>
    </div>
  );
}
