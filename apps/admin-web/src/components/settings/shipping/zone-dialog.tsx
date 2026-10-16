"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@platform/ui";
import { COUNTRY_CODES, PROVINCES, hasProvinces, provinceName } from "@platform/regions";
import { saveZoneAction } from "@/app/settings/shipping/actions";
import { MoneyInput, Switch } from "@/components/products/editor/controls";
import { CheckboxRow, Field } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import { buildInlineRates, chipProvinces, selectionOfProvinces } from "@/lib/shipping/inline-rates";
import {
  CAIRO_GIZA,
  GREATER_CAIRO,
  remainingProvinces,
  suggestZoneName,
  type QuickSetupCountry,
} from "@/lib/shipping/quick-setup";
import {
  REST_OF_WORLD,
  countriesFromSelection,
  countryState,
  selectionFromCountries,
  takenBy,
  toggleCountry,
  toggleProvince,
  type Selection,
  type ZoneDto,
} from "@/lib/shipping/zones";
import type { Dictionary } from "@/messages/en";
import { RateFields, initialRateFields } from "./rate-fields";

const INITIAL_STATE: FormState = { status: "idle" };

function nounFor(code: string, t: Dictionary["shippingSettings"]): string {
  if (code === "SA") return t.nounSA;
  if (code === "AE") return t.nounAE;
  return t.nounEG;
}

/** A checkbox that can show the "some governorates" state. */
function CountryCheckbox({
  label,
  checked,
  partial,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly partial: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <CheckboxRow
      ref={ref}
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/**
 * Plan 3C — create or edit a shipping zone (Shopify: "Create shipping zone"): a name and a searchable
 * list of countries. A country with province data expands to its governorates / regions / emirates;
 * ticking the country ticks them all, which is the whole country. Countries and provinces another zone
 * already holds are shown disabled, naming that zone ("a country can only be in one zone"). The
 * countries travel as one JSON field the server action validates.
 */
export function ZoneDialogContent({
  zone,
  zones,
  homeCountry,
  currency,
  onClose,
  t,
  locale,
}: {
  readonly zone: ZoneDto | null;
  readonly zones: readonly ZoneDto[];
  /** The store's own country: listed first, with its provinces open, and the shortcuts are for it. */
  readonly homeCountry: QuickSetupCountry;
  readonly currency: string;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.shippingSettings;
  const [state, formAction, isPending] = useActionState(saveZoneAction, INITIAL_STATE);
  const [typedName, setTypedName] = useState(zone?.name ?? "");
  // The name follows the selection until the merchant types; an existing zone's name is never touched.
  const [nameTyped, setNameTyped] = useState(zone !== null);
  const [selection, setSelection] = useState<Selection>(() =>
    selectionFromCountries(zone?.countries ?? []),
  );
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([homeCountry]));
  const [rate, setRate] = useState(() => initialRateFields(null, currency, locale));
  const [freeOn, setFreeOn] = useState(false);
  const [freeOver, setFreeOver] = useState("");
  const errors = state.status === "error" ? state.fieldErrors : {};
  const name = nameTyped ? typedName : suggestZoneName(selection, zones, zone?.id ?? null, locale);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  const taken = useMemo(() => takenBy(zones, zone?.id ?? null), [zones, zone]);
  const countries = useMemo(() => {
    const names = COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) }));
    const sorted = names.sort((a, b) => a.name.localeCompare(b.name, locale));
    const home = sorted.filter(({ code }) => code === homeCountry);
    return [...home, ...sorted.filter(({ code }) => code !== homeCountry)];
  }, [locale, homeCountry]);
  const shortcuts = useMemo(() => {
    const exceptId = zone?.id ?? null;
    const left = remainingProvinces(homeCountry, zones, exceptId);
    const all = {
      label: copy.chipAllRemaining.replace("{noun}", nounFor(homeCountry, copy)),
      left,
    };
    const egypt = [
      { label: copy.chipCairoGiza, left: chipProvinces(CAIRO_GIZA, "EG", zones, exceptId) },
      { label: copy.chipGreaterCairo, left: chipProvinces(GREATER_CAIRO, "EG", zones, exceptId) },
    ];
    return (homeCountry === "EG" ? [...egypt, all] : [all]).map(({ label, left: provinces }) => ({
      label,
      selection: selectionOfProvinces(homeCountry, provinces),
      empty: provinces.length === 0,
    }));
  }, [homeCountry, zones, zone, copy]);
  const selectedJson = JSON.stringify(countriesFromSelection(selection));
  const ratesJson = JSON.stringify(
    buildInlineRates(
      { name: rate.name, description: rate.description, price: rate.price },
      freeOn ? freeOver : null,
      copy.freeShipping,
    ),
  );
  const query = search.trim().toLowerCase();
  const visible = countries.filter(
    ({ code, name: label }) =>
      query.length === 0 || label.toLowerCase().includes(query) || code.toLowerCase() === query,
  );

  function toggleExpanded(code: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const worldTaken = taken.get(REST_OF_WORLD)?.whole;

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{zone === null ? copy.createZone : copy.editZone}</DialogTitle>
        <DialogDescription className="sr-only">{copy.countries}</DialogDescription>
      </DialogHeader>

      <form action={formAction} className="flex flex-col gap-4">
        {zone !== null && <input type="hidden" name="zoneId" value={zone.id} />}
        <input type="hidden" name="countries" value={selectedJson} />
        {zone === null && <input type="hidden" name="rates" value={ratesJson} />}

        <Field label={copy.zoneName} name="name" error={errors["name"]}>
          {(control) => (
            <Input
              {...control}
              maxLength={80}
              value={name}
              onChange={(event) => {
                setTypedName(event.target.value);
                setNameTyped(true);
              }}
            />
          )}
        </Field>

        <Field label={copy.searchCountries} name="search">
          {(control) => (
            <Input
              id={control.id}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </Field>

        <div role="group" aria-label={copy.shortcuts} className="flex flex-wrap gap-2">
          {shortcuts.map((shortcut) => (
            <Button
              key={shortcut.label}
              type="button"
              variant="outline"
              size="sm"
              disabled={
                shortcut.empty ||
                JSON.stringify(countriesFromSelection(shortcut.selection)) === selectedJson
              }
              onClick={() => setSelection(shortcut.selection)}
            >
              {shortcut.label}
            </Button>
          ))}
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{copy.countries}</legend>
          <div className="border-border max-h-72 overflow-y-auto rounded-md border p-2">
            {query.length === 0 && (
              <div className="flex items-center gap-2 py-1">
                <CountryCheckbox
                  label={copy.restOfWorld}
                  checked={countryState(selection, REST_OF_WORLD) === "all"}
                  partial={false}
                  disabled={worldTaken !== undefined}
                  onChange={(checked) =>
                    setSelection((current) => toggleCountry(current, REST_OF_WORLD, checked))
                  }
                />
                {worldTaken !== undefined && (
                  <span className="text-muted-foreground text-xs">
                    {copy.inZone.replace("{zone}", worldTaken)}
                  </span>
                )}
              </div>
            )}
            {visible.length === 0 && (
              <p className="text-muted-foreground py-2 text-sm">{copy.noCountryMatches}</p>
            )}
            {visible.map(({ code, name: label }) => {
              const holder = taken.get(code);
              const wholeTaken = holder?.whole;
              const someTaken = (holder?.provinces.size ?? 0) > 0;
              const provinces = hasProvinces(code) ? (PROVINCES[code] ?? []) : [];
              const status = countryState(selection, code);
              const noun = nounFor(code, copy);
              const open = expanded.has(code);
              return (
                <div key={code} className="flex flex-col gap-1 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CountryCheckbox
                      label={label}
                      checked={status === "all"}
                      partial={status === "some"}
                      disabled={wholeTaken !== undefined || someTaken}
                      onChange={(checked) =>
                        setSelection((current) => toggleCountry(current, code, checked))
                      }
                    />
                    {wholeTaken !== undefined && (
                      <span className="text-muted-foreground text-xs">
                        {copy.inZone.replace("{zone}", wholeTaken)}
                      </span>
                    )}
                    {provinces.length > 0 && wholeTaken === undefined && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={open}
                        onClick={() => toggleExpanded(code)}
                      >
                        {(open ? copy.hideProvinces : copy.showProvinces).replace("{noun}", noun)}
                      </Button>
                    )}
                  </div>
                  {open && provinces.length > 0 && (
                    <div className="grid gap-1 ps-6 sm:grid-cols-2">
                      {provinces.map((province) => {
                        const holderZone = holder?.provinces.get(province.code);
                        const chosen = selection[code];
                        const checked =
                          chosen === "all" || (chosen !== undefined && chosen.has(province.code));
                        return (
                          <div key={province.code} className="flex flex-col">
                            <CheckboxRow
                              label={provinceName(province.code, locale)}
                              checked={checked}
                              disabled={holderZone !== undefined}
                              onChange={(event) =>
                                setSelection((current) =>
                                  toggleProvince(
                                    current,
                                    code,
                                    province.code,
                                    event.target.checked,
                                  ),
                                )
                              }
                            />
                            {holderZone !== undefined && (
                              <span className="text-muted-foreground ps-6 text-xs">
                                {copy.inZone.replace("{zone}", holderZone)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {errors["countries"] !== undefined && (
            <p role="alert" className="text-destructive text-xs">
              {errors["countries"]}
            </p>
          )}
        </fieldset>

        {zone === null && (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-medium">{copy.rateSection}</legend>
            <RateFields
              value={rate}
              onChange={setRate}
              currency={currency}
              locale={locale}
              t={t}
              errors={errors}
              names={{ name: "rateName", description: "rateDescription", price: "ratePrice" }}
            />
            <Switch label={copy.freeOverToggle} checked={freeOn} onCheckedChange={setFreeOn} />
            {freeOn && (
              <Field label={copy.freeOverAmount} name="freeOver">
                {(control) => (
                  <MoneyInput
                    id={control.id}
                    name={control.name}
                    label={copy.freeOverAmount}
                    currency={currency}
                    locale={locale}
                    value={freeOver}
                    onValueChange={setFreeOver}
                  />
                )}
              </Field>
            )}
            {errors["rates"] !== undefined && (
              <p role="alert" className="text-destructive text-xs">
                {errors["rates"]}
              </p>
            )}
          </fieldset>
        )}

        {state.status === "error" && errors["countries"] === undefined && (
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
