import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, PlusIcon } from "lucide-react";
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
import { pickText } from "@platform/storefront-content";
import { AppShell } from "@/components/app-shell";
import { fetchMenus } from "@/lib/api/online-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { menuDisplayTitle } from "@/lib/online-store/menu-copy";

/**
 * Online Store → Navigation (spec 2.7, Shopify's Navigation page): the main menu and footer first,
 * then the shop's own menus. Viewer-readable (`ROUTE_ROLE_REQUIREMENTS`); Add menu is offered to
 * operators and admins. The API enforces every permission itself.
 */
export default async function OnlineStoreNavigationPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const n = t.onlineStoreNavigation;
  const [user, session, menus] = await Promise.all([getCurrentUser(), readSession(), fetchMenus()]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-navigation" user={user}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{n.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{n.subtitle}</p>
          </div>
          {canEdit ? (
            <Button asChild>
              <Link href="/online-store/navigation/new">
                <PlusIcon aria-hidden="true" />
                {n.addMenu}
              </Link>
            </Button>
          ) : null}
        </header>
        {menus.outcome === "ok" ? (
          <Card>
            <CardContent className="p-0 sm:p-0">
              <Table aria-label={n.title}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{n.columnMenu}</TableHead>
                    <TableHead>{n.columnItems}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {menus.data.map((menu) => {
                    const labels = menu.topLabels
                      .map((label) => pickText(label, locale))
                      .filter((label): label is string => label !== null);
                    return (
                      <TableRow key={menu.handle}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/online-store/navigation/${encodeURIComponent(menu.handle)}`}
                            className="hover:text-primary"
                          >
                            <bdi dir="auto">{menuDisplayTitle(t, menu)}</bdi>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {labels.length === 0 ? (
                            n.noItems
                          ) : (
                            <bdi dir="auto">{labels.join(", ")}</bdi>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
            <AlertTriangleIcon className="size-4" aria-hidden="true" />
            {menus.outcome === "unauthorized" ? t.formErrors.forbidden : n.loadError}
          </p>
        )}
      </div>
    </AppShell>
  );
}
