import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, InfoIcon, LockIcon } from "lucide-react";
import {
  Badge,
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
import { LocaleSwitch } from "@/components/locale-switch";
import { fetchUsageCounters } from "@/lib/api/licensing";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * The Settings screen (Phase A.30). Split by real ownership rather than presented as one flat
 * form: "Interface" is genuinely admin-web-only (the language toggle, reusing the same
 * `setLocale` server action the topbar switcher already calls). "Workspace & billing" names real,
 * backend-owned aggregates (Tenancy's `Workspace.config`, Licensing's `Plan`/`Subscription`) that
 * this build cannot read back — not because a read method is missing, but because admin-web has no
 * authenticated session to resolve *which* workspace/tenant is "current" (see Phase A.30's Admin
 * Authentication audit), and neither context exposes a list to discover one without that. Shown as
 * an explicit unavailable state rather than a guessed or hardcoded tenant id.
 *
 * T3.5: that reasoning still holds for `Workspace`/`Plan`/`Subscription` — Tenancy's read side
 * doesn't exist until Phase 4 — but it does **not** hold for Licensing's `GET /usage-counters`
 * (`apps/admin/src/http/licensing-routes.ts`). That route is scoped by the `x-tenant-id` header
 * `lib/api/client.ts` already sends on every admin-web request, so no workspace/tenant resolution
 * is needed. The "Workspace & billing" card below is therefore half-live: the unavailable badge
 * still covers workspace config and plan/subscription, and a real, tenant-scoped usage-counters
 * table renders underneath it (`lib/api/licensing.ts`'s `fetchUsageCounters`).
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
          <h1 className="text-4xl font-semibold tracking-tight">{t.settingsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.settingsPage.subtitle}</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t.settingsPage.frontendSection}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">{t.settingsPage.frontendBody}</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t.settingsPage.languageLabel}</span>
              <LocaleSwitch locale={locale} label={t.settingsPage.languageLabel} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.settingsPage.backendSection}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">{t.settingsPage.backendBody}</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                <InfoIcon aria-hidden="true" className="size-3.5" />
                {t.settingsPage.unavailableLabel}
              </Badge>
            </div>

            <div className="border-border border-t pt-4">
              <h3 className="text-sm font-semibold">{t.settingsPage.usageSectionTitle}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{t.settingsPage.usageSectionBody}</p>
              <Suspense fallback={<UsageCountersSkeleton />}>
                <UsageCountersSection t={t} />
              </Suspense>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

async function UsageCountersSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchUsageCounters();

  if (result.outcome === "unauthorized") {
    return (
      <div
        role="note"
        className="text-muted-foreground mt-3 flex items-center gap-2 text-sm"
      >
        <LockIcon aria-hidden="true" className="size-4" />
        {t.settingsPage.usageUnauthorized}
      </div>
    );
  }
  if (result.outcome === "error") {
    return (
      <div
        role="note"
        className="text-muted-foreground mt-3 flex items-center gap-2 text-sm"
      >
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
              <TableCell className="text-end text-muted-foreground">
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
