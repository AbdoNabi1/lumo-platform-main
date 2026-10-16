"use client";

import { useId } from "react";
import { Button, cn } from "@platform/ui";
import { discountClassOf } from "@/lib/discounts/model";
import { generateDiscountCode } from "@/lib/discounts/form";
import { FormCard, TextField, type CardProps } from "./inputs";

/** The save action keeps at most this many characters of a text field (`parseFormValues`). */
const MAX_TEXT_LENGTH = 255;

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
  const groupName = useId();
  const labelId = useId();
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
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-1.5">
        <span id={labelId} className="text-sm">
          {copy.method}
        </span>
        <div className="bg-muted inline-flex w-fit rounded-lg p-0.5">
          {methods.map((method) => (
            <label key={method.value} className="has-[:enabled]:cursor-pointer">
              <input
                type="radio"
                name={groupName}
                className="peer sr-only"
                checked={values.method === method.value}
                disabled={mode === "edit" && values.method !== method.value}
                onChange={() => set({ method: method.value })}
              />
              <span
                className={cn(
                  "text-muted-foreground block rounded-md px-3 py-1 text-sm",
                  "peer-checked:bg-card peer-checked:text-foreground peer-checked:font-medium peer-checked:shadow-sm",
                  "peer-focus-visible:ring-primary peer-focus-visible:ring-2 peer-disabled:opacity-50",
                )}
              >
                {method.label}
              </span>
            </label>
          ))}
        </div>
      </div>
      {values.method === "code" ? (
        <TextField
          label={copy.code}
          value={values.code}
          onValueChange={(code) => set({ code })}
          maxLength={MAX_TEXT_LENGTH}
          dir="ltr"
          autoCapitalize="characters"
          spellCheck={false}
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
          maxLength={MAX_TEXT_LENGTH}
          error={errors["title"]}
          hint={copy.titleHint}
        />
      )}
    </FormCard>
  );
}
