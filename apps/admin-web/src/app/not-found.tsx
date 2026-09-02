import { cookies } from "next/headers";
import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Not-found page.
 *
 * The admin navigation lists the full operator surface, but only the Dashboard route is
 * built so far. Rather than dropping an operator onto Next's unstyled default, an
 * unbuilt destination lands here — inside the Lumo chrome, with the navigation still
 * available and the situation stated plainly.
 */
export default async function NotFound() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <AppShell t={t} locale={locale} activeNavId="" user={user}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span
              className="bg-primary-subtle text-primary-subtle-foreground flex size-12 items-center justify-center rounded-2xl"
              aria-hidden="true"
            >
              <CompassIcon className="size-6" />
            </span>
            <h1 className="text-3xl font-semibold tracking-tight">{t.notFound.title}</h1>
            <p className="text-muted-foreground text-md max-w-md">{t.notFound.body}</p>
            <Button asChild>
              <Link href="/">{t.notFound.backToDashboard}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
