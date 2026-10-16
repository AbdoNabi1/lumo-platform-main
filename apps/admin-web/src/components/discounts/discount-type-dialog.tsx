"use client";

import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import { DISCOUNT_TYPES } from "@/lib/api/discounts";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify's "Create discount" button and its "Select discount type" dialog: the four types, each with
 * a one-line description, each opening the form for that type.
 */
export function DiscountTypeDialog({ t }: { readonly t: Dictionary }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden="true" />
          {t.discounts.create}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.discounts.typeDialogTitle}</DialogTitle>
        </DialogHeader>
        <ul className="border-border flex flex-col divide-y rounded-xl border">
          {DISCOUNT_TYPES.map((type) => (
            <li key={type}>
              <Link
                href={`/discounts/new?type=${type}`}
                className="hover:bg-muted flex items-center gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
              >
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{t.discounts.types[type]}</span>
                  <span className="text-muted-foreground text-xs">
                    {t.discounts.typeDescriptions[type]}
                  </span>
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-4 rtl:-scale-x-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
