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
import type { Dictionary } from "@/messages/en";

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Resolves `customerRef` against Identity's `GetCustomer` (Phase 2 productization — see
 * `services/identity/src/application/get-customer.use-case.ts`). An async Server Component in
 * its own `<Suspense>` boundary on the Order Detail page, so a slow or failed Identity lookup
 * never blocks the rest of the order from rendering. A resolution failure is shown honestly
 * (the raw reference), never invented as a name.
 */
export async function OrderCustomerCard({
  customerRef,
  t,
}: {
  readonly customerRef: string;
  readonly t: Dictionary;
}) {
  const result = await fetchCustomer(customerRef);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.customer}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "ok" ? (
          <Link
            href={`/customers/${result.customer.id}`}
            className="hover:text-primary flex items-center gap-3"
          >
            <Avatar>
              <AvatarFallback>{initialsOf(result.customer.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">{result.customer.name}</p>
              <p className="text-muted-foreground truncate text-sm">{result.customer.email}</p>
            </div>
          </Link>
        ) : (
          <div>
            <p className="text-muted-foreground text-sm">{t.orderDetail.noCustomerLinked}</p>
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">{t.orderDetail.customerRefLabel}: </span>
              <span className="font-mono">{customerRef}</span>
            </p>
          </div>
        )}
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
