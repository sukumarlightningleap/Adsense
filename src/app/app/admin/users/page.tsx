import { auth } from "@/auth";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

import { CreateUserForm } from "./create-user-form";
import { toggleUserActiveAction } from "./actions";

export const metadata = {
  title: "Users",
};

export default async function AdminUsersPage() {
  const session = await auth();
  const callerId = session!.user.id;

  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  return (
    <div className="container-page py-12 md:py-16">
      <header className="max-w-3xl">
        <div className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand">
          — Admin · Users
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
          Users
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-[15px] leading-7 text-muted-foreground">
          Create members and demo logins. Members see live data only. Demo
          users see the shared demo dataset only. Admins see everything and
          can toggle between the two.
        </p>
      </header>

      {/* Create user */}
      <section className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Create user
        </div>
        <div className="mt-5">
          <CreateUserForm />
        </div>
      </section>

      {/* Existing users */}
      <section className="mt-10">
        <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Existing users · {users.length}
        </div>

        {/* Mobile — card list */}
        <ul className="mt-4 space-y-3 md:hidden">
          {users.map((u) => {
            const isSelf = u.id === callerId;
            return (
              <li
                key={u.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-semibold">
                      {u.name}{" "}
                      {isSelf && (
                        <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
                      {u.email}
                    </div>
                  </div>
                  <RoleBadge role={u.role} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Created
                    </div>
                    <div className="mt-0.5 text-foreground/80">
                      {formatDate(u.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Last login
                    </div>
                    <div className="mt-0.5 text-foreground/80">
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                    </div>
                  </div>
                </div>
                {!isSelf && (
                  <form
                    action={toggleUserActiveAction}
                    className="mt-3 border-t border-border pt-3"
                  >
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      type="submit"
                      className={cn(
                        "w-full rounded-md border px-2.5 py-2 text-[12.5px] font-medium transition-colors",
                        u.isActive
                          ? "border-border bg-background hover:bg-muted"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
                      )}
                    >
                      {u.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        {/* Desktop — table */}
        <div className="mt-4 hidden overflow-hidden rounded-2xl border border-border md:block">
          <div className="grid grid-cols-12 gap-4 border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4">User</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">Created</div>
            <div className="col-span-2">Last login</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          {users.map((u) => {
            const isSelf = u.id === callerId;
            return (
              <div
                key={u.id}
                className="grid grid-cols-12 items-center gap-4 border-b border-border px-5 py-4 last:border-b-0 hover:bg-muted/30"
              >
                <div className="col-span-4 min-w-0">
                  <div className="truncate text-[14px] font-medium">
                    {u.name}{" "}
                    {isSelf && (
                      <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {u.email}
                  </div>
                </div>
                <div className="col-span-2">
                  <RoleBadge role={u.role} />
                </div>
                <div className="col-span-2 text-[12px] text-muted-foreground">
                  {formatDate(u.createdAt)}
                </div>
                <div className="col-span-2 text-[12px] text-muted-foreground">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  {isSelf ? (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  ) : (
                    <form action={toggleUserActiveAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <button
                        type="submit"
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors",
                          u.isActive
                            ? "border-border bg-background hover:bg-muted"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
                        )}
                      >
                        {u.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const palette: Record<string, string> = {
    admin: "border-brand/40 bg-brand/10 text-brand",
    member: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    demo: "border-violet-500/30 bg-violet-500/10 text-violet-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
        palette[role] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {role}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}
