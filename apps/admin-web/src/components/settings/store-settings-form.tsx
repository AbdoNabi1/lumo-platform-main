"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { CURRENCY_CODES } from "@platform/regions";
import { saveStoreSettingsAction } from "@/app/settings/general/actions";
import { Field, NativeSelect } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import type { StoreSettingsDto, WeightUnit } from "@/lib/api/store-settings";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };
const FORM_ID = "store-settings";

interface Values {
  readonly storeName: string;
  readonly contactEmail: string;
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: WeightUnit;
}

function valuesOf(settings: StoreSettingsDto): Values {
  return {
    storeName: settings.storeName,
    contactEmail: settings.contactEmail ?? "",
    currency: settings.currency,
    timezone: settings.timezone,
    weightUnit: settings.weightUnit,
  };
}

function sameValues(a: Values, b: Values): boolean {
  return (
    a.storeName === b.storeName &&
    a.contactEmail === b.contactEmail &&
    a.currency === b.currency &&
    a.timezone === b.timezone &&
    a.weightUnit === b.weightUnit
  );
}

/** "EGP — Egyptian Pound": the code merchants search by, and the name in the interface language. */
function currencyLabel(code: string, locale: Locale): string {
  try {
    const name = new Intl.DisplayNames(locale, { type: "currency" }).of(code);
    return name === undefined || name === code ? code : `${code} — ${name}`;
  } catch {
    return code;
  }
}

function timeZones(current: string): readonly string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const all = new Set<string>(["UTC", ...supported]);
  all.add(current);
  return [...all].sort();
}

/**
 * Plan 3C — Settings → General: store name, contact email, store currency, time zone, weight unit.
 * Save stays off until a field differs from what was last saved (the product editor's rule). Changing
 * the currency asks first: it relabels prices without converting them.
 */
export function StoreSettingsForm({
  settings,
  t,
  locale,
}: {
  readonly settings: StoreSettingsDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.generalSettings;
  const [state, formAction, isPending] = useActionState(saveStoreSettingsAction, INITIAL_STATE);
  const [values, setValues] = useState<Values>(() => valuesOf(settings));
  const [saved, setSaved] = useState<Values>(() => valuesOf(settings));
  const submitted = useRef<Values | null>(null);

  // A fresh read from the server (after Save, or a reload) is the new "what was saved".
  useEffect(() => {
    const fresh = valuesOf(settings);
    setValues(fresh);
    setSaved(fresh);
  }, [settings]);

  // A successful Save makes what was submitted the saved state at once, before the page refreshes.
  useEffect(() => {
    if (state.status === "success" && submitted.current !== null) setSaved(submitted.current);
  }, [state]);

  const zones = useMemo(() => timeZones(settings.timezone), [settings.timezone]);
  const currencies = useMemo(
    () =>
      CURRENCY_CODES.includes(settings.currency)
        ? CURRENCY_CODES
        : [...CURRENCY_CODES, settings.currency],
    [settings.currency],
  );
  const dirty = !sameValues(values, saved);
  const errors: Readonly<Record<string, string>> =
    state.status === "error" ? state.fieldErrors : {};

  function set<K extends keyof Values>(key: K, value: Values[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      id={FORM_ID}
      noValidate
      action={formAction}
      onSubmit={(event) => {
        if (
          values.currency !== saved.currency &&
          !window.confirm(copy.confirmBody.replace("{code}", values.currency))
        ) {
          event.preventDefault();
          return;
        }
        submitted.current = values;
      }}
      className="flex flex-col gap-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>{copy.storeDetails}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label={copy.storeName} name="storeName" error={errors["storeName"]}>
            {(control) => (
              <Input
                {...control}
                maxLength={120}
                value={values.storeName}
                onChange={(event) => set("storeName", event.target.value)}
              />
            )}
          </Field>
          <Field
            label={copy.contactEmail}
            name="contactEmail"
            hint={copy.contactEmailHint}
            error={errors["contactEmail"]}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                value={values.contactEmail}
                onChange={(event) => set("contactEmail", event.target.value)}
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.standards}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label={copy.currency}
            name="currency"
            hint={copy.currencyHint}
            error={errors["currency"]}
            className="sm:col-span-2"
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={values.currency}
                onChange={(event) => set("currency", event.target.value)}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {currencyLabel(code, locale)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={copy.timezone} name="timezone" error={errors["timezone"]}>
            {(control) => (
              <NativeSelect
                {...control}
                value={values.timezone}
                onChange={(event) => set("timezone", event.target.value)}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            label={copy.weightUnit}
            name="weightUnit"
            hint={copy.weightUnitHint}
            error={errors["weightUnit"]}
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={values.weightUnit}
                onChange={(event) => set("weightUnit", event.target.value as WeightUnit)}
              >
                <option value="kg">{copy.unitKg}</option>
                <option value="g">{copy.unitG}</option>
                <option value="lb">{copy.unitLb}</option>
                <option value="oz">{copy.unitOz}</option>
              </NativeSelect>
            )}
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {state.status === "error" && (
          <p role="alert" className="text-destructive me-auto text-sm">
            {state.message}
          </p>
        )}
        {state.status === "success" && !dirty && (
          <p role="status" className="text-muted-foreground me-auto text-sm">
            {copy.saved}
          </p>
        )}
        {dirty && <span className="text-muted-foreground text-sm">{copy.unsaved}</span>}
        <Button type="submit" loading={isPending} disabled={!dirty || isPending}>
          {isPending ? copy.saving : copy.save}
        </Button>
      </div>
    </form>
  );
}
