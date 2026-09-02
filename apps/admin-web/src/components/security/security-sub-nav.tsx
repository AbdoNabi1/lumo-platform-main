"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

interface SecurityScreen {
  readonly id: string;
  readonly href: string;
  readonly label: (t: Dictionary) => string;
}

const SECURITY_SCREENS: readonly SecurityScreen[] = [
  { id: "overview", href: "/security", label: (t) => t.securityNav.overview },
  { id: "identity", href: "/security/identity", label: (t) => t.securityNav.identity },
  { id: "access", href: "/security/access", label: (t) => t.securityNav.access },
  { id: "sessions", href: "/security/sessions", label: (t) => t.securityNav.sessions },
  { id: "audit", href: "/security/audit", label: (t) => t.securityNav.audit },
  { id: "secrets", href: "/security/secrets", label: (t) => t.securityNav.secrets },
  { id: "ai-governance", href: "/security/ai-governance", label: (t) => t.securityNav.aiGovernance },
];

/**
 * The sub-navigation across the seven Security Console screens (T3.1). A client component
 * because it preserves the `?tenantRef=` filter across screens — the same reason `OrdersToolbar`
 * is a client component: the current URL's querystring is the only place the filter lives.
 */
export function SecuritySubNav({ t }: { readonly t: Dictionary }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tenantRef = searchParams.get("tenantRef");
  const suffix = tenantRef !== null && tenantRef.length > 0 ? `?tenantRef=${tenantRef}` : "";

  return (
    <nav aria-label={t.nav.security} className="border-border/60 flex flex-wrap gap-1 border-b pb-2">
      {SECURITY_SCREENS.map((screen) => {
        const active =
          screen.href === "/security" ? pathname === "/security" : pathname.startsWith(screen.href);
        return (
          <Link
            key={screen.id}
            href={`${screen.href}${suffix}`}
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
