import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ComponentLifecycleActions } from "@/components/components-library/component-lifecycle-actions";
import { ComponentStatusBadge } from "@/components/components-library/component-status-badge";
import { fetchComponent } from "@/lib/api/component-library";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface ComponentDetailPageProps {
  readonly params: Promise<{ readonly componentDefinitionId: string }>;
}

/**
 * The Component Detail screen (T5.9c). Resolves the real
 * `GET /components/:componentDefinitionId` endpoint (`components:read`) and renders the full
 * field set plus the "advance to…" lifecycle control (`ComponentLifecycleActions`, gated by
 * `lib/component-library-lifecycle.ts`).
 */
export default async function ComponentDetailPage({ params }: ComponentDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { componentDefinitionId } = await params;

  const result = await fetchComponent(componentDefinitionId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="components-library" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.componentDetail.unauthorized}
          backLabel={t.componentDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="components-library" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.componentDetail.notFound}
          backLabel={t.componentDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="components-library" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.componentDetail.error}
          backLabel={t.componentDetail.back}
        />
      </AppShell>
    );
  }

  const component = result.component;

  return (
    <AppShell t={t} locale={locale} activeNavId="components-library" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/components-library">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.componentDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{component.name}</h1>
            <ComponentStatusBadge status={component.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{component.key}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.componentDetail.responsive}>
              {component.responsive ? t.componentsPage.yes : t.componentsPage.no}
            </Field>
            <Field label={t.componentDetail.permission}>
              {component.permission ?? t.componentDetail.none}
            </Field>
            <Field label={t.componentDetail.featureFlagKey}>
              {component.featureFlagKey ?? t.componentDetail.none}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t.componentDetail.propertiesTitle}</h2>
            {component.properties.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.componentDetail.noProperties}</p>
            ) : (
              <Table aria-label={t.componentDetail.propertiesTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.componentCreate.propertyName}</TableHead>
                    <TableHead>{t.componentCreate.propertyType}</TableHead>
                    <TableHead>{t.componentCreate.propertyRequired}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {component.properties.map((property) => (
                    <TableRow key={property.name}>
                      <TableCell className="font-mono text-xs">{property.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {(t.componentPropertyType as Record<string, string>)[property.type] ??
                          property.type}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {property.required ? t.componentCreate.yes : t.componentCreate.no}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.componentDetail.slotsTitle}>
              {component.slots.length === 0 ? t.componentDetail.none : component.slots.join(", ")}
            </Field>
            <Field label={t.componentDetail.eventsTitle}>
              {component.events.length === 0 ? t.componentDetail.none : component.events.join(", ")}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t.componentDetail.defaultsTitle}</h2>
            <pre className="bg-muted overflow-x-auto rounded-xl p-3 font-mono text-xs">
              {JSON.stringify(component.defaults, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <ComponentLifecycleActions
              componentDefinitionId={component.id}
              status={component.status}
              t={t}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm">{children}</span>
    </div>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/components-library">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
