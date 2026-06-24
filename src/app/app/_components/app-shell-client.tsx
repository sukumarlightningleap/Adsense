"use client";

/**
 * Client wrapper that controls whether the desktop sidebar is shown.
 *
 * On focus-mode routes (Create Campaign, single Campaign detail) the
 * sidebar auto-hides to give the user the full screen width. A small
 * floating "Menu" button restores it on demand.
 *
 * The mobile top-bar is always rendered — mobile users have no sidebar
 * gutter to worry about, the drawer pattern handles it.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";

import { MobileTopBar, Sidebar } from "./sidebar";

type SidebarUser = {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "member" | "demo";
};

type Props = {
  user: SidebarUser;
  signOutAction: () => Promise<void>;
  demoMode: boolean;
  setDemoModeAction: (value: boolean) => Promise<void>;
  children: React.ReactNode;
};

// Routes where the sidebar auto-hides for a wider workspace.
const FOCUS_MODE_ROUTES: RegExp[] = [
  /^\/app\/create$/,
  /^\/app\/campaigns\/[^/]+$/, // single campaign detail (not the list)
];

function isFocusRoute(pathname: string): boolean {
  return FOCUS_MODE_ROUTES.some((re) => re.test(pathname));
}

export function AppShellClient({
  user,
  signOutAction,
  demoMode,
  setDemoModeAction,
  children,
}: Props) {
  const pathname = usePathname();
  const focusMode = isFocusRoute(pathname);

  // User can override the auto-hide for the current visit by clicking the
  // floating Menu button. Resets whenever the focus-mode status flips
  // (so leaving + re-entering a focus route reapplies the hide).
  const [userExpanded, setUserExpanded] = useState(false);
  useEffect(() => {
    setUserExpanded(false);
  }, [focusMode]);

  const sidebarVisible = !focusMode || userExpanded;

  return (
    <>
      {sidebarVisible && (
        <Sidebar
          user={user}
          signOutAction={signOutAction}
          demoMode={demoMode}
          setDemoModeAction={setDemoModeAction}
        />
      )}
      <MobileTopBar
        user={user}
        signOutAction={signOutAction}
        demoMode={demoMode}
        setDemoModeAction={setDemoModeAction}
      />
      <main className={cn("flex-1", sidebarVisible && "lg:pl-60")}>
        {focusMode && !userExpanded && (
          <button
            type="button"
            onClick={() => setUserExpanded(true)}
            aria-label="Show navigation"
            className="fixed left-3 top-3 z-50 hidden size-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted lg:inline-flex"
          >
            <Menu className="size-4" />
          </button>
        )}
        {children}
      </main>
    </>
  );
}
