import Link from "next/link";
import { LogoLockup } from "@/components/shared/logo";
import { site } from "@/lib/site";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container-page py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2">
            <LogoLockup />
            <p className="mt-3 max-w-xs text-[13px] leading-6 text-muted-foreground">
              {site.tagline} Built by Lightning Leap Analytics.
            </p>
          </div>

          <FooterCol title="Product" items={site.footer.product} />
          <FooterCol title="Company" items={site.footer.company} />
          <FooterCol title="Legal" items={site.footer.legal} />
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-[12px] text-muted-foreground sm:flex-row sm:items-center">
          <div>© {new Date().getFullYear()} Adsense. All rights reserved.</div>
          <div className="font-mono text-[11px]">v0.1.0 · early access</div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  items,
}: {
  title: string;
  items: readonly { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="text-[12px] font-semibold tracking-tight">{title}</div>
      <ul className="mt-3 space-y-2">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
