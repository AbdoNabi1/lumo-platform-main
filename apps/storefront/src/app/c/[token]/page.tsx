import type { Metadata } from "next";
import { cache } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { LineThumb } from "@/components/line-thumb";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { SubmitButton } from "@/components/submit-button";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { getCheckoutLinkPreview, type CheckoutLinkPreview } from "@/lib/runtime-api";
import { claimCheckoutLink } from "./actions";

/** A bearer link: rendered per request, never cached or statically generated. */
export const dynamic = "force-dynamic";

/** As the API mints them: 32 bytes, base64url. Anything else is invalid without a lookup. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLAIM_ERRORS = ["invalid", "unavailable", "network"] as const;

interface CheckoutLinkPageProps {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<{ readonly error?: string }>;
}

async function localized(): Promise<{
  readonly locale: Locale;
  readonly t: ReturnType<typeof dictionaryFor>;
}> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return { locale, t: dictionaryFor(locale) };
}

/**
 * The preview is a plain GET with no side effect — rendering this page never claims the link.
 * `cache` shares one GET between `generateMetadata` and the page within a request.
 */
const previewOf = cache(async (token: string): Promise<CheckoutLinkPreview | null> => {
  if (!TOKEN_PATTERN.test(token)) return null;
  const response = await getCheckoutLinkPreview(token);
  return response.status === 200 ? response.body : null;
});

/** The "Your order from {shop}" sentence with the shop name isolated, so its script cannot reorder the words around it. */
function FromShop({ template, shop }: { readonly template: string; readonly shop: string }) {
  const at = template.indexOf("{shop}");
  if (at === -1) return <>{template}</>;
  return (
    <>
      {template.slice(0, at)}
      <bdi>{shop}</bdi>
      {template.slice(at + "{shop}".length)}
    </>
  );
}

/**
 * WhatsApp's link preview reads this: the shop's name, never anything about the shopper. The page
 * sends no Referer (`no-referrer`), so the token in its path never leaks to the hosts of images or
 * links it loads, and it is kept out of search indexes.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const { t } = await localized();
  const preview = await previewOf(token);
  const title =
    preview === null || preview.shopName === ""
      ? t.recovery.metaTitle
      : `${preview.shopName} — ${t.recovery.metaTitle}`;
  return {
    title,
    openGraph: { title },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * `/c/<token>` — a recovery link a merchant shared (order operations Part 3, spec §3.8): the items and
 * total, and ONE button. Pressing it runs the `claimCheckoutLink` server action, which makes this
 * browser's own checkout and opens `/checkout`.
 */
export default async function CheckoutLinkPage({ params, searchParams }: CheckoutLinkPageProps) {
  const { token } = await params;
  const { error } = await searchParams;
  const { locale, t } = await localized();
  const preview = await previewOf(token);
  const claimError = CLAIM_ERRORS.find((key) => key === error);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />
      {preview === null ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.recovery.invalidTitle}
          body={t.recovery.invalidBody}
          action={{ href: "/", label: t.recovery.backToShop }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold">{t.recovery.title}</h1>
              {preview.shopName !== "" && (
                <p dir="auto" className="text-muted-foreground">
                  <FromShop template={t.recovery.fromShop} shop={preview.shopName} />
                </p>
              )}
            </div>
            <ul className="flex flex-col gap-3">
              {preview.items.map((item, index) => (
                <li key={index} className="flex items-center gap-3">
                  <LineThumb
                    url={item.imageUrl}
                    alt={item.title ?? t.recovery.itemFallback}
                    size={48}
                    noImageLabel={t.product.gallery.noImage}
                  />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate font-medium">
                      {item.title ?? t.recovery.itemFallback}
                    </p>
                    {item.variantTitle !== null && (
                      <p dir="auto" className="text-muted-foreground text-sm">
                        {item.variantTitle}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {t.recovery.quantity.replace("{count}", () => String(item.quantity))}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-border flex items-center justify-between border-t pt-4 font-medium">
              <span>{t.recovery.total}</span>
              <span className="tabular-nums">
                {formatCurrency(locale, preview.totalMinor, preview.currency)}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{t.recovery.pricesNote}</p>
            {claimError !== undefined && (
              <p role="alert" className="text-destructive text-sm">
                {t.recovery.errors[claimError]}
              </p>
            )}
            <form action={claimCheckoutLink.bind(null, token)}>
              <SubmitButton className="w-full" pendingLabel={t.recovery.continuing}>
                {t.recovery.continue}
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
