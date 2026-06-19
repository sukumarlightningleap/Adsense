"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Building2,
  Database,
  ImageIcon,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { LogoLockup } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

import { DemoToggle } from "./demo-toggle";

type SectionItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type Section = {
  label: string;
  items: SectionItem[];
  adminOnly?: boolean;
};

const SECTIONS: Section[] = [
  {
    label: "Workspace",
    items: [
      { href: "/app", label: "Overview", icon: LayoutDashboard },
      { href: "/app/preview", label: "Preview", icon: Sparkles },
      { href: "/app/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/app/accounts", label: "Accounts", icon: Building2 },
      { href: "/app/assets", label: "Assets", icon: ImageIcon },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { href: "/app/admin/users", label: "Users", icon: Users },
      { href: "/app/admin/demo", label: "Demo data", icon: Database },
    ],
  },
];

type Props = {
  user: {
    id: string;
    name: string | null;
    email: string;
    role: "admin" | "member" | "demo";
  };
  signOutAction: () => Promise<void>;
  /** Effective demo mode (after role rules). */
  demoMode: boolean;
  /** Admin-only toggle action. Sidebar hides the toggle for non-admins. */
  setDemoModeAction: (value: boolean) => Promise<void>;
};

export function Sidebar({
  user,
  signOutAction,
  demoMode,
  setDemoModeAction,
}: Props) {
  const pathname = usePathname();
  const isAdmin = user.role === "admin";

  function isActive(href: string): boolean {
    if (href === "/app") return pathname === "/app";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-background lg:flex"
    >
      {/* Brand */}
      <div className="flex h-14 items-center px-5 border-b border-border">
        <Link
          href="/app"
          aria-label="Adsense home"
          className="-ml-1 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogoLockup />
        </Link>
      </div>

      {/* Demo toggle (admin only) */}
      {isAdmin && (
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Dataset
          </div>
          <DemoToggle current={demoMode} setAction={setDemoModeAction} />
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {SECTIONS.filter((s) => !s.adminOnly || isAdmin).map((section) => (
          <div key={section.label}>
            <div className="px-2 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-foreground/[0.06] text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User pill */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="grid size-8 place-items-center rounded-full bg-foreground text-background font-semibold text-[11px]">
            {initials(user.name ?? user.email)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-tight">
              {user.name ?? user.email}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {user.email}
            </div>
          </div>
          <RoleDot role={user.role} />
        </div>
        <form action={signOutAction} className="mt-1">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4 shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

/**
 * Mobile header for the app shell. Replaces the fixed desktop sidebar
 * with a slim top bar + hamburger that opens a full-screen nav drawer.
 */
export function MobileTopBar({
  user,
  signOutAction,
  demoMode,
  setDemoModeAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the user navigates.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isAdmin = user.role === "admin";

  function isActive(href: string): boolean {
    if (href === "/app") return pathname === "/app";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/app" aria-label="Adsense home">
            <LogoLockup />
          </Link>
        </div>
        <RoleDot role={user.role} />
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] flex flex-col bg-background lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="App menu"
          >
            {/* Drawer header */}
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <LogoLockup />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Demo toggle (admin only) */}
            {isAdmin && (
              <div className="border-b border-border px-5 py-4">
                <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Dataset
                </div>
                <DemoToggle
                  current={demoMode}
                  setAction={setDemoModeAction}
                />
              </div>
            )}

            {/* Nav sections */}
            <motion.nav
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.2 }}
              className="flex-1 overflow-y-auto px-3 py-5 space-y-6"
            >
              {SECTIONS.filter((s) => !s.adminOnly || isAdmin).map(
                (section) => (
                  <div key={section.label}>
                    <div className="px-2 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {section.label}
                    </div>
                    <ul className="space-y-0.5">
                      {section.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className={cn(
                                "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[15px] font-medium transition-colors",
                                active
                                  ? "bg-foreground/[0.06] text-foreground"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                              )}
                            >
                              <Icon className="size-4 shrink-0" />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ),
              )}
            </motion.nav>

            {/* User + sign out */}
            <div className="border-t border-border p-4">
              <div className="flex items-center gap-3 px-1 py-2">
                <div className="grid size-9 place-items-center rounded-full bg-foreground text-background font-semibold text-[12px]">
                  {initials(user.name ?? user.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium leading-tight">
                    {user.name ?? user.email}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {user.email}
                  </div>
                </div>
                <RoleDot role={user.role} />
              </div>
              <form action={signOutAction} className="mt-2">
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background py-2.5 text-[14px] font-medium hover:bg-muted"
                >
                  <LogOut className="size-4 shrink-0" />
                  Sign out
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function RoleDot({ role }: { role: "admin" | "member" | "demo" }) {
  const map: Record<string, string> = {
    admin: "bg-brand",
    member: "bg-emerald-500",
    demo: "bg-violet-500",
  };
  return (
    <span
      aria-label={`role: ${role}`}
      className={cn("size-2 rounded-full shrink-0", map[role])}
    />
  );
}

function initials(s: string): string {
  const parts = s.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
