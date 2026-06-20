import { CreateForm } from "./create-form";
import { listLaunchableAccounts } from "./actions";

export const metadata = { title: "Create campaign · Adsense" };

/**
 * /app/create — the autopilot Create Campaign UX.
 *
 * Server-fetches the user's launchable Google Ads accounts (live,
 * non-manager) so Bucket 3 can render an account picker without an
 * extra round-trip on mount.
 *
 * Parent /app layout enforces auth.
 */
export default async function CreatePage() {
  const accounts = await listLaunchableAccounts();
  return <CreateForm accounts={accounts} />;
}
