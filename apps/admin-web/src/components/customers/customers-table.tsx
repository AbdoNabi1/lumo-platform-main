import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { CustomerListItemDto } from "@/lib/api/customers";
import type { Dictionary } from "@/messages/en";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function CustomersTable({
  customers,
  t,
}: {
  readonly customers: readonly CustomerListItemDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.customersPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.customersPage.columns.name}</TableHead>
          <TableHead>{t.customersPage.columns.email}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id}>
            <TableCell className="font-medium">
              <Link
                href={`/customers/${customer.id}`}
                className="hover:text-primary flex items-center gap-2"
                aria-label={t.customersPage.viewCustomer.replace("{name}", customer.name)}
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initialsOf(customer.name)}</AvatarFallback>
                </Avatar>
                {customer.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{customer.email}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
