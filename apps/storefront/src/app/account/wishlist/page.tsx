import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, HeartIcon } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { WishlistView } from "@/components/wishlist-view";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { resolveMyWishlist } from "@/lib/wishlist";

/**
 * The customer's wishlist page (T5.17 Part B) — the first screen backed by the Part A session
 * foundation. Everything shown was scoped server-side by the `customerRef` `CustomerGuard` derived
 * from the opaque session cookie; this page never sends, receives, or holds a `customerRef` or a
 * wishlist id.
 *
 * Four distinct states, deliberately kept apart:
 *  - signed out → redirect to sign-in. NOT an empty wishlist: rendering "you have saved nothing"
 *    to someone who is not signed in asserts something false about their account (T5.16 §3).
 *  - error      → an explicit unavailable panel, never an empty list.
 *  - empty      → a real, honest empty state for a signed-in customer who has saved nothing yet.
 *  - ok         → the wishlist, joined to Catalog for names and links.
 */
export default async function WishlistPage() {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const result = await resolveMyWishlist(jar.get(CUSTOMER_SESSION_COOKIE)?.value);
  if (result.status === "signed-out") redirect("/account/login");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link
        href="/account"
        className="text-muted-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.account.title}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight">{t.wishlist.title}</h1>

      {result.status === "error" ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.wishlist.errorTitle}
          body={t.wishlist.errorBody}
          action={{ href: "/", label: t.wishlist.backToShop }}
        />
      ) : result.status === "empty" ? (
        <StatePanel
          icon={<HeartIcon className="size-6" />}
          title={t.wishlist.emptyTitle}
          body={t.wishlist.emptyBody}
          action={{ href: "/", label: t.wishlist.backToShop }}
        />
      ) : (
        <WishlistView lines={result.lines} t={t} />
      )}
    </main>
  );
}
