import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderAddressDto } from "@/lib/api/orders";
import type { Dictionary } from "@/messages/en";

export function CustomerAddressesCard({
  addresses,
  t,
}: {
  readonly addresses: readonly OrderAddressDto[];
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.customerDetail.addresses}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {addresses.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.customerDetail.noAddresses}</p>
        ) : (
          addresses.map((address, index) => (
            <address key={index} className="text-sm not-italic">
              <p>{address.line1}</p>
              <p>
                {address.city}, {address.postalCode}
              </p>
              <p>{address.country}</p>
            </address>
          ))
        )}
      </CardContent>
    </Card>
  );
}
