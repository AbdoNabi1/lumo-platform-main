import type { Metadata } from "next";
import { cache } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, CheckCircleIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { IsolatedText } from "@/components/isolated-text";
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
const CLAIM_ERRORS = [
  "invalid",
  "unavailable",
  "completed",
  "notReady",
  "busy",
  "tooLarge",
  "outOfStock",
  "network",
] as const;

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

/** What the preview GET found: the link, a link that cannot be used, or no answer at all. */
type PreviewRead =
  | { readonly kind: "ok"; readonly preview: CheckoutLinkPreview }
  | { readonly kind: "invalid" }
  | { readonly kind: "failed" };

/**
 * The preview is a plain GET with no side effect — rendering this page never claims the link.
 * `cache` shares one GET between `generateMetadata` and the page within a request. Only an answer
 * from the API makes a link invalid (404 `LINK_INVALID`); no answer or a server error is "try
 * again", never "expired": the link in the shopper's chat may be perfectly good.
 */
const previewOf = cache(async (token: string): Promise<PreviewRead> => {
  if (!TOKEN_PATTERN.test(token)) return { kind: "invalid" };
  const response = await getCheckoutLinkPreview(token);
  if (response.status === 200 && response.body !== null) {
    return { kind: "ok", preview: response.body };
  }
  return response.status === 0 || response.status >= 500 ? { kind: "failed" } : { kind: "invalid" };
});

/**
 * WhatsApp's link preview reads this: the shop's name and a generic label, never anything about the
 * shopper (nor the draft number). The page sends no Referer (`no-referrer`), so the token in its path
 * never leaks to the hosts of images or links it loads, and it is kept out of search indexes.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const { t } = await localized();
  const read = await previewOf(token);
  const preview = read.kind === "ok" ? read.preview : null;
  const label = preview?.purpose === "invoice" ? t.invoice.metaTitle : t.recovery.metaTitle;
  const title =
    preview === null || preview.shopName === "" ? label : `${preview.shopName} — ${label}`;
  return {
    title,
    openGraph: { title },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * `/c/<token>` — a recovery link (order operations Part 3, spec §3.8) or an invoice link for a draft
 * order (Part 4, spec §4.7) a merchant shared: the items and total, and ONE button. Pressing it runs
 * the `claimCheckoutLink` server action, which makes this browser's own checkout and opens
 * `/checkout`. Rendering claims nothing (link-preview bots fetch this page); an invoice whose order
 * was already placed says so instead, with no button.
 */
export default async function CheckoutLinkPage({ params, searchParams }: CheckoutLinkPageProps) {
  const { token } = await params;
  const { error } = await searchParams;
  const { locale, t } = await localized();
  const read = await previewOf(token);
  const preview = read.kind === "ok" ? read.preview : null;
  const claimError = CLAIM_ERRORS.find((key) => key === error);
  const isInvoice = preview?.purpose === "invoice";
  // The order exists already: the preview says so, or the claim just found it (placed meanwhile).
  const alreadyPlaced = isInvoice && (preview.completed || claimError === "completed");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />
      {read.kind === "failed" ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.recovery.loadFailedTitle}
          body={t.recovery.loadFailedBody}
          action={{ href: `/c/${token}`, label: t.recovery.tryAgain }}
        />
      ) : preview === null ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.recovery.invalidTitle}
          body={t.recovery.invalidBody}
          action={{ href: "/", label: t.recovery.backToShop }}
        />
      ) : alreadyPlaced ? (
        <StatePanel
          icon={<CheckCircleIcon className="size-6" />}
          title={t.invoice.completedTitle}
          body={t.invoice.completedBody}
          action={{ href: "/", label: t.recovery.backToShop }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold">
                {isInvoice ? (
                  <IsolatedText
                    template={t.invoice.title}
                    token="#{draft}"
                    value={`#${preview.draftNumber ?? ""}`}
                  />
                ) : (
                  t.recovery.title
                )}
              </h1>
              {preview.shopName !== "" && (
                <p dir="auto" className="text-muted-foreground">
                  <IsolatedText
                    template={isInvoice ? t.invoice.fromShop : t.recovery.fromShop}
                    token="{shop}"
                    value={preview.shopName}
                  />
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
              <span>
                {isInvoice && preview.taxPending ? t.invoice.totalBeforeTax : t.recovery.total}
              </span>
              <span className="tabular-nums">
                {formatCurrency(locale, preview.totalMinor, preview.currency)}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              {isInvoice
                ? preview.taxPending
                  ? t.invoice.taxPendingNote
                  : t.invoice.totalNote
                : t.recovery.pricesNote}
            </p>
            {claimError !== undefined && (
              <p role="alert" className="text-destructive text-sm">
                {t.recovery.errors[claimError]}
              </p>
            )}
            <form action={claimCheckoutLink.bind(null, token, preview.purpose)}>
              <SubmitButton
                className="w-full"
                pendingLabel={isInvoice ? t.invoice.paying : t.recovery.continuing}
              >
                {isInvoice ? t.invoice.pay : t.recovery.continue}
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
