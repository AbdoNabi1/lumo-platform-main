"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@platform/ui";
import { COUNTRY_CODES, PROVINCES, hasProvinces, provinceName } from "@platform/regions";
import { saveRegionAction } from "@/app/settings/taxes/actions";
import { Field, NativeSelect } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import type { TaxRegionDto } from "@/lib/api/taxes";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import { basisPointsToPercent } from "@/lib/taxes/rates";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface Override {
  code: string;
  rate: string;
}

/**
 * Plan 3C — add or edit a tax region (Shopify: a country under Taxes and duties): the country's rate
 * and, for countries with province data, rates that REPLACE it in chosen provinces. Rates are typed as
 * percents (up to two decimals) and the server action turns them into basis points.
 */
export function RegionDialogContent({
  region,
  existing,
  onClose,
  t,
  locale,
}: {
  readonly region: TaxRegionDto | null;
  /** The country codes that already have a region. */
  readonly existing: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.taxSettings;
  const [state, formAction, isPending] = useActionState(saveRegionAction, INITIAL_STATE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  const [country, setCountry] = useState(region?.countryCode ?? "");
  const [rate, setRate] = useState(
    region === null ? "" : basisPointsToPercent(region.rateBasisPoints),
  );
  const [overrides, setOverrides] = useState<Override[]>(
    () =>
      region?.provinces.map((p) => ({
        code: p.code,
        rate: basisPointsToPercent(p.rateBasisPoints),
      })) ?? [],
  );

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  const choices = useMemo(
    () =>
      COUNTRY_CODES.filter((code) => !existing.has(code))
        .map((code) => ({ code, name: countryName(code, locale) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [existing, locale],
  );
  const provinces = hasProvinces(country) ? (PROVINCES[country] ?? []) : [];

  function changeCountry(next: string): void {
    setCountry(next);
    setOverrides([]);
  }

  function setOverride(index: number, patch: Partial<Override>): void {
    setOverrides((current) => current.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  function addOverride(): void {
    const used = new Set(overrides.map((o) => o.code));
    const next = provinces.find((province) => !used.has(province.code));
    if (next !== undefined) setOverrides((current) => [...current, { code: next.code, rate: "" }]);
  }

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{region === null ? copy.addRegion : copy.editRegion}</DialogTitle>
        <DialogDescription className="sr-only">{copy.regionsBody}</DialogDescription>
      </DialogHeader>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="overrides" value={JSON.stringify(overrides)} />
        {region === null ? (
          <Field label={copy.country} name="country" error={errors["country"]}>
            {(control) => (
              <NativeSelect
                {...control}
                value={country}
                onChange={(event) => changeCountry(event.target.value)}
              >
                <option value="">{copy.chooseCountry}</option>
                {choices.map((choice) => (
                  <option key={choice.code} value={choice.code}>
                    {choice.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : (
          <>
            <input type="hidden" name="country" value={region.countryCode} />
            <p className="text-sm font-medium">{countryName(region.countryCode, locale)}</p>
          </>
        )}

        <Field label={copy.rateLabel} name="rate" hint={copy.rateHint} error={errors["rate"]}>
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          )}
        </Field>

        {provinces.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{copy.overrides}</legend>
            <p className="text-muted-foreground text-xs">{copy.overridesHint}</p>
            {overrides.map((override, index) => (
              <div key={override.code} className="flex items-end gap-2">
                <Field label={copy.province} name={`override-province-${index}`} className="flex-1">
                  {(control) => (
                    <NativeSelect
                      id={control.id}
                      aria-invalid={control["aria-invalid"]}
                      value={override.code}
                      onChange={(event) => setOverride(index, { code: event.target.value })}
                    >
                      {provinces
                        .filter(
                          (province) =>
                            province.code === override.code ||
                            !overrides.some((o) => o.code === province.code),
                        )
                        .map((province) => (
                          <option key={province.code} value={province.code}>
                            {provinceName(province.code, locale)}
                          </option>
                        ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={copy.provinceRate} name={`override-rate-${index}`} className="w-32">
                  {(control) => (
                    <Input
                      id={control.id}
                      inputMode="decimal"
                      value={override.rate}
                      onChange={(event) => setOverride(index, { rate: event.target.value })}
                    />
                  )}
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOverrides((current) => current.filter((_, i) => i !== index))}
                >
                  {copy.removeOverride}
                </Button>
              </div>
            ))}
            {errors["overrides"] !== undefined && (
              <p role="alert" className="text-destructive text-xs">
                {errors["overrides"]}
              </p>
            )}
            {errors["provinces"] !== undefined && (
              <p role="alert" className="text-destructive text-xs">
                {errors["provinces"]}
              </p>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOverride}
                disabled={overrides.length >= provinces.length}
              >
                {copy.addOverride}
              </Button>
            </div>
          </fieldset>
        )}

        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" loading={isPending}>
            {isPending ? copy.saving : copy.save}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
