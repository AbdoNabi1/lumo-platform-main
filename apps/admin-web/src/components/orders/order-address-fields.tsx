"use client";

import { useId } from "react";
import { Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * One address block (line1/city/postalCode/country) named with the `${prefix}Line1` /
 * `${prefix}City` / `${prefix}PostalCode` / `${prefix}Country` convention `app/orders/
 * actions.ts`'s `parseAddress` reads back off `FormData`. Shared by `OrderCreateForm` (shipping
 * only) and `OrderFromCheckoutForm` (billing + shipping). Per-field errors are looked up under the
 * server's zod dot-path key (e.g. `shippingAddress.line1`, per `packages/http/src/server.ts`'s
 * `issue.path.join(".")`); the whole-block key (e.g. `shippingAddress`) covers this form's own
 * client-side parse failure, rendered once above the block.
 */
export function OrderAddressFields({
  t,
  prefix,
  title,
  fieldErrors,
}: {
  readonly t: Dictionary;
  readonly prefix: "shipping" | "billing";
  readonly title: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
}) {
  const formId = useId();
  const blockKey = `${prefix}Address`;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {fieldErrors[blockKey] !== undefined && (
        <p className="text-destructive text-sm">{fieldErrors[blockKey]}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <AddressField
          id={`${formId}-${prefix}-line1`}
          name={`${prefix}Line1`}
          label={t.orderAddressForm.line1}
          error={fieldErrors[`${blockKey}.line1`]}
        />
        <AddressField
          id={`${formId}-${prefix}-city`}
          name={`${prefix}City`}
          label={t.orderAddressForm.city}
          error={fieldErrors[`${blockKey}.city`]}
        />
        <AddressField
          id={`${formId}-${prefix}-postalCode`}
          name={`${prefix}PostalCode`}
          label={t.orderAddressForm.postalCode}
          error={fieldErrors[`${blockKey}.postalCode`]}
        />
        <AddressField
          id={`${formId}-${prefix}-country`}
          name={`${prefix}Country`}
          label={t.orderAddressForm.country}
          error={fieldErrors[`${blockKey}.country`]}
        />
      </div>
    </div>
  );
}

function AddressField({
  id,
  name,
  label,
  error,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
