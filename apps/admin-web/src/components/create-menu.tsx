"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDownIcon, PackageIcon, PercentIcon, ShoppingBagIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/** The topbar's primary action — the one primary-variant button on the page. */
export function CreateMenu({ t }: { readonly t: Dictionary }) {
  const items = [
    { id: "product", label: t.topbar.createProduct, href: "/products/new", Icon: PackageIcon },
    { id: "order", label: t.topbar.createOrder, href: "/orders/new", Icon: ShoppingBagIcon },
    { id: "discount", label: t.topbar.createDiscount, href: "/discounts/new", Icon: PercentIcon },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="md">
          {t.topbar.create}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map(({ id, label, href, Icon }) => (
          <DropdownMenuItem key={id} asChild>
            <Link href={href}>
              <Icon aria-hidden="true" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
