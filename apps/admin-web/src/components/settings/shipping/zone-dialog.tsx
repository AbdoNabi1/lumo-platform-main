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
import { CheckboxRow, Field } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
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
  onClose,
  t,
  locale,
}: {
  readonly zone: ZoneDto | null;
  readonly zones: readonly ZoneDto[];
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.shippingSettings;
  const [state, formAction, isPending] = useActionState(saveZoneAction, INITIAL_STATE);
  const [name, setName] = useState(zone?.name ?? "");
  const [selection, setSelection] = useState<Selection>(() =>
    selectionFromCountries(zone?.countries ?? []),
  );
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const errors = state.status === "error" ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  const taken = useMemo(() => takenBy(zones, zone?.id ?? null), [zones, zone]);
  const countries = useMemo(() => {
    const names = COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) }));
    return names.sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);
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
        <input
          type="hidden"
          name="countries"
          value={JSON.stringify(countriesFromSelection(selection))}
        />

        <Field label={copy.zoneName} name="name" error={errors["name"]}>
          {(control) => (
            <Input
              {...control}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
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
