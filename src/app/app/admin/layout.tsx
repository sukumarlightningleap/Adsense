import { redirect } from "next/navigation";

import { auth } from "@/auth";

/**
 * Admin gate. Any route nested under /app/admin/* hits this layout first
 * and bounces non-admins back to the overview.
 *
 * /app/layout already enforces "must be signed in" — by the time we get
 * here, `session.user` is guaranteed.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    redirect("/app");
  }
  return children;
}
