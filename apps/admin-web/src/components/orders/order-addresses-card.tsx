import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderRecipientAddressDto } from "@/lib/api/orders";
import type { Locale } from "@/lib/i18n";
import { addressForClipboard, addressLines, mapSearchUrl } from "@/lib/order-address";
import type { Dictionary } from "@/messages/en";
import { CopyButton } from "./copy-button";

/**
 * The shipping address card, like Shopify's: the recipient's name, the address with the country as a
 * NAME (not "EG"), the phone as a call link, a Copy button (the whole address) and a "View map" link
 * that opens a map search for the delivery address in a new tab (`rel="noopener noreferrer"`; the
 * recipient's name and phone are never sent to the map).
 */
export function OrderShippingAddressCard({
  address,
  t,
  locale,
}: {
  readonly address: OrderRecipientAddressDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const lines = addressLines({ ...address, phone: null }, locale);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t.orderDetail.shippingAddress}</CardTitle>
        <CopyButton
          text={addressForClipboard(address, locale)}
          label={t.orderPage.copy}
          copiedLabel={t.orderPage.copied}
          ariaLabel={t.orderPage.copyAddress}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <address className="flex flex-col text-sm not-italic">
          {lines.map((line, index) =>
            index === 0 && address.recipientName !== null ? (
              <strong key={`${index}-${line}`}>{line}</strong>
            ) : (
              <span key={`${index}-${line}`}>{line}</span>
            ),
          )}
          {address.phone !== null && (
            <a href={`tel:${address.phone}`} dir="ltr" className="self-start underline">
              {address.phone}
            </a>
          )}
        </address>
        <a
          href={mapSearchUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary self-start text-sm underline"
        >
          {t.orderPage.viewMap}
        </a>
      </CardContent>
    </Card>
  );
}

/** The billing address: "Same as shipping address" when it is, the address when it is not. */
export function OrderBillingAddressCard({
  shippingAddress,
  billingAddress,
  t,
  locale,
}: {
  readonly shippingAddress: OrderRecipientAddressDto;
  readonly billingAddress: OrderRecipientAddressDto | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const sameAsShipping =
    billingAddress !== null &&
    billingAddress.recipientName === shippingAddress.recipientName &&
    billingAddress.phone === shippingAddress.phone &&
    billingAddress.line1 === shippingAddress.line1 &&
    billingAddress.line2 === shippingAddress.line2 &&
    billingAddress.city === shippingAddress.city &&
    billingAddress.postalCode === shippingAddress.postalCode &&
    billingAddress.country === shippingAddress.country;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.billingAddress}</CardTitle>
      </CardHeader>
      <CardContent>
        {billingAddress === null ? (
          <p className="text-muted-foreground text-sm">{t.orderDetail.noBillingAddress}</p>
        ) : sameAsShipping ? (
          <p className="text-muted-foreground text-sm">{t.orderDetail.sameAsShipping}</p>
        ) : (
          <address className="flex flex-col text-sm not-italic">
            {addressLines(billingAddress, locale).map((line, index) => (
              <span key={`${index}-${line}`}>{line}</span>
            ))}
          </address>
        )}
      </CardContent>
    </Card>
  );
}
