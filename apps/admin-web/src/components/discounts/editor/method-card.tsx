"use client";

import { Button, cn } from "@platform/ui";
import { discountClassOf } from "@/lib/api/discounts";
import { generateDiscountCode } from "@/lib/discounts/form";
import { FormCard, TextField, type CardProps } from "./inputs";

/**
 * The type card at the top of Shopify's form: the type as its heading, the class beside it, the
 * method (code or automatic — fixed once saved), then the code with "Generate random code", or the
 * automatic discount's title.
 */
export function MethodCard({
  values,
  set,
  errors,
  t,
  mode,
}: CardProps & { readonly mode: "create" | "edit" }) {
  const copy = t.discounts.form;
  const methods = [
    { value: "code", label: copy.methodCode },
    { value: "automatic", label: copy.methodAutomatic },
  ] as const;
  return (
    <FormCard
      title={t.discounts.types[values.type]}
      aside={
        <span className="text-muted-foreground text-xs">
          {t.discounts.classes[discountClassOf(values.type)]}
        </span>
      }
    >
      <div role="radiogroup" aria-label={copy.method} className="flex flex-col gap-1.5">
        <span className="text-sm">{copy.method}</span>
        <div className="bg-muted inline-flex w-fit rounded-lg p-0.5">
          {methods.map((method) => (
            <button
              key={method.value}
              type="button"
              role="radio"
              aria-checked={values.method === method.value}
              disabled={mode === "edit" && values.method !== method.value}
              onClick={() => set({ method: method.value })}
              className={cn(
                "rounded-md px-3 py-1 text-sm disabled:opacity-50",
                values.method === method.value
                  ? "bg-card font-medium shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {method.label}
            </button>
          ))}
        </div>
      </div>
      {values.method === "code" ? (
        <TextField
          label={copy.code}
          value={values.code}
          onValueChange={(code) => set({ code })}
          error={errors["code"]}
          hint={copy.codeHint}
          end={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set({ code: generateDiscountCode() })}
            >
              {copy.generate}
            </Button>
          }
        />
      ) : (
        <TextField
          label={copy.title}
          value={values.title}
          onValueChange={(title) => set({ title })}
          error={errors["title"]}
          hint={copy.titleHint}
        />
      )}
    </FormCard>
  );
}
