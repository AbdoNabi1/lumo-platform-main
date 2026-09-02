"use client";

import { useActionState, useId, useState, type ComponentProps } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createProductAction } from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface VariantRow {
  readonly key: string;
}

let nextRowKey = 0;
function newRowKey(): string {
  nextRowKey += 1;
  return `row-${nextRowKey}`;
}

/** The reference create-screen form (Phase 1 T1.3). `useActionState` drives `createProductAction`; every field error the API reports renders under its input via `aria-describedby`. */
export function ProductCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createProductAction, INITIAL_STATE);
  const [rows, setRows] = useState<readonly VariantRow[]>([{ key: newRowKey() }]);
  const formId = useId();

  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  function addRow(): void {
    setRows((current) => [...current, { key: newRowKey() }]);
  }

  function removeRow(key: string): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${formId}-sku`}
          name="sku"
          label={t.productCreate.sku}
          error={fieldErrors["sku"]}
        />
        <Field
          id={`${formId}-name`}
          name="name"
          label={t.productCreate.name}
          error={fieldErrors["name"]}
        />
        <Field
          id={`${formId}-slug`}
          name="slug"
          label={t.productCreate.slug}
          error={fieldErrors["slug"]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.productCreate.variants}</h2>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon aria-hidden="true" />
            {t.productCreate.addVariant}
          </Button>
        </div>

        {fieldErrors["variants"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["variants"]}</p>
        )}

        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_6rem_2.5rem]">
              <Field
                id={`${formId}-variant-sku-${index}`}
                name="variantSku"
                label={t.productCreate.variantSku}
                hideLabel={index > 0}
              />
              <Field
                id={`${formId}-variant-price-${index}`}
                name="variantPriceAmountMinor"
                label={t.productCreate.variantPrice}
                hideLabel={index > 0}
                inputMode="numeric"
              />
              <Field
                id={`${formId}-variant-currency-${index}`}
                name="variantCurrency"
                label={t.productCreate.variantCurrency}
                hideLabel={index > 0}
                maxLength={3}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={index === 0 ? "mt-6" : undefined}
                disabled={rows.length === 1}
                onClick={() => removeRow(row.key)}
                aria-label={t.productCreate.removeVariant}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.productCreate.submitting : t.productCreate.submit}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  error,
  hideLabel = false,
  ...inputProps
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly hideLabel?: boolean;
} & Omit<ComponentProps<"input">, "id" | "name">) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        {...inputProps}
      />
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
