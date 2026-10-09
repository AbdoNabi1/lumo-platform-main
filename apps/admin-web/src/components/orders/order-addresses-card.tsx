import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderRecipientAddressDto } from "@/lib/api/orders";
import type { Dictionary } from "@/messages/en";

export function OrderAddressesCard({
  shippingAddress,
  billingAddress,
  t,
}: {
  readonly shippingAddress: OrderRecipientAddressDto;
  readonly billingAddress: OrderRecipientAddressDto | null;
  readonly t: Dictionary;
}) {
  const billingMatchesShipping =
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
        <CardTitle>{t.orderDetail.shippingAddress}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AddressBlock address={shippingAddress} />

        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.orderDetail.billingAddress}
          </p>
          {billingAddress === null ? (
            <p className="text-muted-foreground text-sm">{t.orderDetail.noBillingAddress}</p>
          ) : billingMatchesShipping ? (
            <p className="text-muted-foreground text-sm">{t.orderDetail.sameAsShipping}</p>
          ) : (
            <AddressBlock address={billingAddress} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Absent fields render nothing — no blank lines for a missing name, second line or phone. */
function AddressBlock({ address }: { readonly address: OrderRecipientAddressDto }) {
  const cityLine = [address.city, address.postalCode].filter((part) => part !== "").join(", ");
  return (
    <address className="text-sm not-italic">
      {address.recipientName !== null && (
        <p>
          <strong>{address.recipientName}</strong>
        </p>
      )}
      <p>{address.line1}</p>
      {address.line2 !== null && address.line2 !== "" && <p>{address.line2}</p>}
      <p>{cityLine}</p>
      <p>{address.country}</p>
      {address.phone !== null && (
        <p>
          <a href={`tel:${address.phone}`} dir="ltr" className="underline">
            {address.phone}
          </a>
        </p>
      )}
    </address>
  );
}
