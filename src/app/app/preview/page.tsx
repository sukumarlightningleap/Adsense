import { PreviewForm } from "./preview-form";

export const metadata = {
  title: "Preview · Adsense",
};

/**
 * /app/preview — the autopilot black-box UI.
 *
 * The parent /app layout already enforces auth + non-public-route
 * protections, so this is a pure client-form shell.
 */
export default function PreviewPage() {
  return <PreviewForm />;
}
