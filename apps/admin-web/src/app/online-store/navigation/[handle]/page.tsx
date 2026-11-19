import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { MenuEditor } from "@/components/online-store/menu-editor";
import { fetchMenu } from "@/lib/api/online-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { menuDisplayTitle } from "@/lib/online-store/menu-copy";

interface MenuPageProps {
  readonly params: Promise<{ readonly handle: string }>;
}

/**
 * One menu (spec 2.7). Viewers see it read-only; operators and admins edit it. A missing menu is
 * the not-found panel (as on Pages' detail screen), never an error page.
 */
export default async function MenuPage({ params }: MenuPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const n = t.onlineStoreNavigation;
  const { handle } = await params;
  const [user, session, result] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchMenu(handle),
  ]);
  const role = highestRole(session?.roles ?? []) ?? "viewer";

  const panel = (icon: ReactNode, message: string) => (
    <AppShell t={t} locale={locale} activeNavId="online-store-navigation" user={user}>
      <StatePanel icon={icon} message={message} backLabel={n.back} />
    </AppShell>
  );
  if (result.outcome === "unauthorized") {
    return panel(<LockIcon aria-hidden="true" className="size-5" />, t.formErrors.forbidden);
  }
  if (result.outcome === "not_found") {
    return panel(<SearchXIcon aria-hidden="true" className="size-5" />, n.notFound);
  }
  if (result.outcome === "error") {
    return panel(<AlertTriangleIcon aria-hidden="true" className="size-5" />, n.loadError);
  }
  const menu = result.data;
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-navigation" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/online-store/navigation">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {n.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            <bdi dir="auto">{menuDisplayTitle(t, menu)}</bdi>
          </h1>
        </div>
        {/* Not keyed by version: the editor takes the saved menu from its own save's answer, and
            a remount on the refresh that follows would drop the "Saved" line. */}
        <MenuEditor t={t} locale={locale} menu={menu} canEdit={role !== "viewer"} />
      </div>
    </AppShell>
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
            <Link href="/online-store/navigation">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
