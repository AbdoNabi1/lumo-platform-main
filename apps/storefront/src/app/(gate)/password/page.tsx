import type { Metadata } from "next";
import { pickText } from "@platform/storefront-content";
import { PasswordForm } from "@/components/password-form";
import { dictionaryFor } from "@/lib/i18n";
import { getPublicAccess } from "@/lib/online-store";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";
import { safeReturnTo } from "@/lib/return-to";
import { logoSize, lockedMetadataFor } from "@/lib/shell-presentation";
import { storefrontSecrets } from "@/lib/storefront-env";

/** Decision 35 and Review Focus 5: never indexed; a link preview shows the name and "Opening soon". */
export async function generateMetadata(): Promise<Metadata> {
  const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
  return lockedMetadataFor(shell, locale, dictionaryFor(locale));
}

/**
 * Spec 1.12: the store's gate. It never redirects by itself: the middleware sends an unlocked
 * store's visitor on, from the same access cache as the gate (preflight 21).
 */
export default async function PasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly return_to?: string | string[] }>;
}) {
  const [shell, locale, access, params] = await Promise.all([
    getRequestShell(),
    getRequestLocale(),
    getPublicAccess(),
    searchParams,
  ]);
  const returnTo = safeReturnTo(params.return_to);
  const t = dictionaryFor(locale);
  const name = shell.storeName.trim();
  const label = name !== "" ? name : t.brand;
  const logo = shell.brand.logo.image;
  const size = logo === null ? null : logoSize(logo, shell.brand.logo.widthPx);
  const message =
    (access === null ? null : pickText(access.message, locale)) ?? t.password.defaultMessage;
  const adminOrigin = storefrontSecrets().adminOrigin;
  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-xl font-semibold">
          {logo === null || size === null ? (
            <bdi dir="auto">{label}</bdi>
          ) : (
            // <picture>: the lint-accepted plain <img>, as in the shop header.
            <picture>
              <img
                src={logo.url}
                alt={label}
                width={size.width}
                {...(size.height === undefined ? {} : { height: size.height })}
                style={{ width: `${size.width}px` }}
                className="block h-auto max-h-12 max-w-full object-contain"
              />
            </picture>
          )}
        </h1>
        <p dir="auto" className="text-muted-foreground whitespace-pre-line">
          <bdi>{message}</bdi>
        </p>
      </div>
      <PasswordForm t={t} locale={locale} returnTo={returnTo} />
      {adminOrigin === null ? null : (
        <p className="text-muted-foreground text-center text-xs">
          {t.password.ownerPrompt}{" "}
          <a href={adminOrigin} className="underline">
            {t.password.ownerLink}
          </a>
        </p>
      )}
    </>
  );
}
