import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { getEffectiveDemoMode } from "@/lib/demo/cookie";

import { setDemoModeAction } from "./_actions";
import { AppShellClient } from "./_components/app-shell-client";

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
      <AppShellClient
        user={sidebarUser}
        signOutAction={handleSignOut}
        demoMode={demoMode}
        setDemoModeAction={setDemoModeAction}
      >
        {children}
      </AppShellClient>
    </div>
  );
}
