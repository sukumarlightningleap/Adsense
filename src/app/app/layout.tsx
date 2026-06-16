import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";

import { setDemoModeAction } from "./_actions";
import { MobileTopBar, Sidebar } from "./_components/sidebar";

/**
 * Protected app shell.
 *
 * Resolves the user's effective demo mode (admin: cookie; member: false;
 * demo: true) and passes it to the sidebar so the toggle, nav state, and
 * downstream pages stay in lockstep.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const role = session.user.role;
  if (role !== "admin" && role !== "member" && role !== "demo") {
    redirect("/sign-in");
  }

  const demoMode = await getEffectiveDemoMode(role);

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  const sidebarUser = {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    role,
  };

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <Sidebar
        user={sidebarUser}
        signOutAction={handleSignOut}
        demoMode={demoMode}
        setDemoModeAction={setDemoModeAction}
      />
      <MobileTopBar signOutAction={handleSignOut} />
      <main className="flex-1 lg:pl-60">{children}</main>
    </div>
  );
}
