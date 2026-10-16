import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@platform/ui";
import { fetchCustomer } from "@/lib/api/customers";
import type { OrderDetailDto } from "@/lib/api/orders";
import type { Dictionary } from "@/messages/en";
import { CopyButton } from "./copy-button";

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The customer card, like Shopify's sidebar: who the order is for, and "Contact information" — the
 * email and the phone, each with a Copy button. The name is the shipping recipient's (who the shopper
 * typed at checkout), else the customer profile's own; it links to the customer page when Identity
 * resolves `customerRef` (`GetCustomer`). The email is the profile's, the phone the recipient's. A
 * lookup that fails is shown honestly (the raw reference), never invented as a name. An async Server
 * Component in its own `<Suspense>` boundary, so a slow Identity lookup never blocks the order.
 *
 * Name, phone and email are staff-only: this page is behind the admin API, and none of it is ever put
 * in a URL or a log line.
 */
export async function OrderCustomerCard({
  order,
  t,
}: {
  readonly order: OrderDetailDto;
  readonly t: Dictionary;
}) {
  const result = await fetchCustomer(order.customerRef);
  const customer = result.outcome === "ok" ? result.customer : null;
  const name = order.shippingAddress.recipientName ?? customer?.name ?? null;
  const email = customer?.email ?? null;
  const phone = order.shippingAddress.phone;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.customer}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {name === null ? (
          <div>
            <p className="text-muted-foreground text-sm">{t.orderDetail.noCustomerLinked}</p>
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">{t.orderDetail.customerRefLabel}: </span>
              <span className="font-mono">{order.customerRef}</span>
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>{initialsOf(name)}</AvatarFallback>
            </Avatar>
            {customer === null ? (
              <p className="min-w-0 truncate font-medium">{name}</p>
            ) : (
              <Link
                href={`/customers/${customer.id}`}
                className="hover:text-primary min-w-0 truncate font-medium"
              >
                {name}
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t.orderPage.contactInformation}</h3>
          <div className="flex items-center justify-between gap-2 text-sm">
            {email === null ? (
              <span className="text-muted-foreground">{t.orderPage.noEmail}</span>
            ) : (
              <>
                <a href={`mailto:${email}`} className="min-w-0 truncate underline">
                  {email}
                </a>
                <CopyButton
                  text={email}
                  label={t.orderPage.copy}
                  copiedLabel={t.orderPage.copied}
                  ariaLabel={t.orderPage.copyEmail}
                />
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            {phone === null ? (
              <span className="text-muted-foreground">{t.orderPage.noPhone}</span>
            ) : (
              <>
                <a href={`tel:${phone}`} dir="ltr" className="underline">
                  {phone}
                </a>
                <CopyButton
                  text={phone}
                  label={t.orderPage.copy}
                  copiedLabel={t.orderPage.copied}
                  ariaLabel={t.orderPage.copyPhone}
                />
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OrderCustomerCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.orderDetail.customer}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
