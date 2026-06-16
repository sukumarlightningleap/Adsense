import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { MobileTopBar, Sidebar } from "./_components/sidebar";

/**
 * Protected app shell.
 *
 * The proxy (`src/proxy.ts`) also gates `/app/*`, but we `auth()` here too
 * so server components downstream can `await auth()` without a second
 * round-trip. Belt + suspenders.
 *
 * Layout shape:
 *   ┌──────────┬────────────────────────────┐
 *   │ Sidebar  │  page content              │
 *   │ (60w fixed)                            │
 *   │          │                            │
 *   └──────────┴────────────────────────────┘
 * Mobile (<lg): sidebar hidden, top bar appears with brand + sign-out.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  // Narrow the role type for the sidebar.
  const role = session.user.role;
  if (role !== "admin" && role !== "member" && role !== "demo") {
    // Defensive — should never happen given how we mint JWTs.
    redirect("/sign-in");
  }

  const sidebarUser = {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    role,
  };

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <Sidebar user={sidebarUser} signOutAction={handleSignOut} />
      <MobileTopBar signOutAction={handleSignOut} />
      <main className="flex-1 lg:pl-60">{children}</main>
    </div>
  );
}
