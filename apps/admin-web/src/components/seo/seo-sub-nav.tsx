"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

interface SeoScreen {
  readonly id: string;
  readonly href: string;
  readonly label: (t: Dictionary) => string;
}

const SEO_SCREENS: readonly SeoScreen[] = [
  { id: "profiles", href: "/seo/profiles", label: (t) => t.seoNav.profiles },
  { id: "redirects", href: "/seo/redirects", label: (t) => t.seoNav.redirects },
  { id: "sitemaps", href: "/seo/sitemaps", label: (t) => t.seoNav.sitemaps },
  { id: "robots-policies", href: "/seo/robots-policies", label: (t) => t.seoNav.robotsPolicies },
];

/**
 * T5.9b — sub-navigation across the four `/seo/*` screens (`app/seo/layout.tsx`), mirroring T3.1's
 * `SecuritySubNav` pattern. No querystring filter to preserve across screens here (unlike
 * `SecuritySubNav`'s `?tenantRef=`), so this stays a plain nav — still a client component so
 * `usePathname` can highlight the active screen.
 */
export function SeoSubNav({ t }: { readonly t: Dictionary }) {
  const pathname = usePathname();

  return (
    <nav aria-label={t.nav.seo} className="border-border/60 flex flex-wrap gap-1 border-b pb-2">
      {SEO_SCREENS.map((screen) => {
        const active = pathname.startsWith(screen.href);
        return (
          <Link
            key={screen.id}
            href={screen.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              "duration-(--duration-fast) transition-colors ease-out",
              active
                ? "bg-primary-subtle text-primary-subtle-foreground"
                : "text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {screen.label(t)}
          </Link>
        );
      })}
    </nav>
  );
}
