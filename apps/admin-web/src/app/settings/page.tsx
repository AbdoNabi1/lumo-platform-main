import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CreditCardIcon,
  LanguagesIcon,
  LockIcon,
  MapPinIcon,
  ReceiptIcon,
  StoreIcon,
  TruckIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { fetchUsageCounters } from "@/lib/api/licensing";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { showPlatformTools } from "@/lib/platform-tools";
import type { Dictionary } from "@/messages/en";

interface SettingsSection {
  readonly href: string;
  readonly Icon: LucideIcon;
  readonly title: (t: Dictionary) => string;
  readonly body: (t: Dictionary) => string;
}

/** Shopify's settings, in its order, for the sections this platform has. */
const SECTIONS: readonly SettingsSection[] = [
  {
    href: "/settings/general",
    Icon: StoreIcon,
    title: (t) => t.settingsPage.generalTitle,
    body: (t) => t.settingsPage.generalBody,
  },
  {
    href: "/settings/payments",
    Icon: CreditCardIcon,
    title: (t) => t.settingsPage.paymentsTitle,
    body: (t) => t.settingsPage.paymentsBody,
  },
  {
    href: "/settings/shipping",
    Icon: TruckIcon,
    title: (t) => t.settingsPage.shippingTitle,
    body: (t) => t.settingsPage.shippingBody,
  },
  {
    href: "/settings/taxes",
    Icon: ReceiptIcon,
    title: (t) => t.settingsPage.taxesTitle,
    body: (t) => t.settingsPage.taxesBody,
  },
  {
    href: "/inventory",
    Icon: MapPinIcon,
    title: (t) => t.settingsPage.locationsTitle,
    body: (t) => t.settingsPage.locationsBody,
  },
  {
    href: "/locales",
    Icon: LanguagesIcon,
    title: (t) => t.settingsPage.languagesTitle,
    body: (t) => t.settingsPage.languagesBody,
  },
];

/**
 * The Settings screen: one list of the store's settings, as in Shopify. The admin's own language is
 * switched from the topbar, so it is not repeated here.
 *
 * Licensing's usage counters (`GET /usage-counters`, scoped by the `x-tenant-id` header every
 * admin-web request carries) are raw platform resources, not a merchant's plan — they are shown
 * only to the platform team (`ADMIN_PLATFORM_TOOLS`) until a real Plan page exists.
 */
export default async function SettingsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="settings" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t.settingsPage.title}</h1>
        </header>

        <Card>
          <CardContent className="divide-border flex flex-col divide-y p-0">
            {SECTIONS.map(({ href, Icon, title, body }) => (
              <Link
                key={href}
                href={href}
                className="hover:bg-muted/50 flex items-center gap-3 p-4"
              >
                <Icon aria-hidden="true" className="text-muted-foreground size-5" />
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{title(t)}</span>
                  <span className="text-muted-foreground text-sm">{body(t)}</span>
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-4 rtl:rotate-180"
                />
              </Link>
            ))}
          </CardContent>
        </Card>

        {showPlatformTools() && (
          <Card>
            <CardHeader>
              <CardTitle>{t.settingsPage.usageSectionTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">{t.settingsPage.usageSectionBody}</p>
              <Suspense fallback={<UsageCountersSkeleton />}>
                <UsageCountersSection t={t} />
              </Suspense>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

async function UsageCountersSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchUsageCounters();

  if (result.outcome === "unauthorized") {
    return (
      <div role="note" className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
        <LockIcon aria-hidden="true" className="size-4" />
        {t.settingsPage.usageUnauthorized}
      </div>
    );
  }
  if (result.outcome === "error") {
    return (
      <div role="note" className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
        <AlertTriangleIcon aria-hidden="true" className="size-4" />
        {t.settingsPage.usageError}
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-md border">
      <Table aria-label={t.settingsPage.usageSectionTitle}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.settingsPage.usageResourceColumn}</TableHead>
            <TableHead className="text-end">{t.settingsPage.usageAmountColumn}</TableHead>
            <TableHead className="text-end">{t.settingsPage.usageUnitColumn}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.counters.map((counter) => (
            <TableRow key={counter.resource}>
              <TableCell className="font-medium">{counter.resource}</TableCell>
              <TableCell className="text-end tabular-nums">{counter.amount}</TableCell>
              <TableCell className="text-muted-foreground text-end">
                {counter.unit.length > 0 ? counter.unit : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UsageCountersSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}
