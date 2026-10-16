"use client";

import { useActionState, useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@platform/ui";
import { quickSetupAction } from "@/app/settings/shipping/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { Field, NativeSelect } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import { QUICK_SETUP_COUNTRIES, type QuickSetupCountry } from "@/lib/shipping/quick-setup";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Plan 3E — shown when the shop has no shipping zones: the merchant types one or two prices (and,
 * optionally, a free-shipping amount) and the zones and rates are created for them.
 */
export function QuickSetup({
  homeCountry,
  currency,
  t,
  locale,
}: {
  readonly homeCountry: QuickSetupCountry;
  readonly currency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.shippingSettings;
  const [state, formAction, isPending] = useActionState(quickSetupAction, INITIAL_STATE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  const [country, setCountry] = useState<string>(homeCountry);
  const [cityPrice, setCityPrice] = useState("");
  const [restPrice, setRestPrice] = useState("");
  const [freeOver, setFreeOver] = useState("");

  const isEgypt = country === "EG";
  const ready = cityPrice.trim().length > 0 && (!isEgypt || restPrice.trim().length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <CardTitle>{copy.quickSetupTitle}</CardTitle>
        <CardDescription>{copy.quickSetupBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <Field label={copy.quickSetupCountry} name="country" error={errors["country"]}>
            {(control) => (
              <NativeSelect
                {...control}
                value={country}
                onChange={(event) => setCountry(event.target.value)}
              >
                {QUICK_SETUP_COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code, locale)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <p className="text-muted-foreground text-sm">
            {copy.quickSetupCurrency.replace("{currency}", currency)}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={isEgypt ? copy.quickSetupCityPrice : copy.quickSetupWholePrice}
              name="cityPrice"
              error={errors["cityPrice"]}
            >
              {(control) => (
                <MoneyInput
                  id={control.id}
                  name={control.name}
                  invalid={control["aria-invalid"] === true}
                  describedBy={control["aria-describedby"]}
                  label={isEgypt ? copy.quickSetupCityPrice : copy.quickSetupWholePrice}
                  currency={currency}
                  locale={locale}
                  placeholder="50"
                  value={cityPrice}
                  onValueChange={setCityPrice}
                />
              )}
            </Field>
            {isEgypt && (
              <Field label={copy.quickSetupRestPrice} name="restPrice" error={errors["restPrice"]}>
                {(control) => (
                  <MoneyInput
                    id={control.id}
                    name={control.name}
                    invalid={control["aria-invalid"] === true}
                    describedBy={control["aria-describedby"]}
                    label={copy.quickSetupRestPrice}
                    currency={currency}
                    locale={locale}
                    placeholder="75"
                    value={restPrice}
                    onValueChange={setRestPrice}
                  />
                )}
              </Field>
            )}
          </div>

          <Field label={copy.quickSetupFreeOver} name="freeOver" error={errors["freeOver"]}>
            {(control) => (
              <MoneyInput
                id={control.id}
                name={control.name}
                invalid={control["aria-invalid"] === true}
                describedBy={control["aria-describedby"]}
                label={copy.quickSetupFreeOver}
                currency={currency}
                locale={locale}
                value={freeOver}
                onValueChange={setFreeOver}
              />
            )}
          </Field>

          {state.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!ready} loading={isPending}>
              {copy.quickSetupSave}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
