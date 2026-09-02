import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderAddressDto } from "@/lib/api/orders";
import type { Dictionary } from "@/messages/en";

export function OrderAddressesCard({
  shippingAddress,
  billingAddress,
  t,
}: {
  readonly shippingAddress: OrderAddressDto;
  readonly billingAddress: OrderAddressDto | null;
  readonly t: Dictionary;
}) {
  const billingMatchesShipping =
    billingAddress !== null &&
    billingAddress.line1 === shippingAddress.line1 &&
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

function AddressBlock({ address }: { readonly address: OrderAddressDto }) {
  return (
    <address className="text-sm not-italic">
      <p>{address.line1}</p>
      <p>
        {address.city}, {address.postalCode}
      </p>
      <p>{address.country}</p>
    </address>
  );
}
