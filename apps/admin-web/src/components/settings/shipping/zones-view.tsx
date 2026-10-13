"use client";

import { useActionState, useCallback, useId, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { deleteRateAction, deleteZoneAction } from "@/app/settings/shipping/actions";
import type { FormState } from "@/lib/api/mutation";
import type { WeightUnit } from "@/lib/api/store-settings";
import type { Locale } from "@/lib/i18n";
import { describeCondition, formatRatePrice, summarizeCountry } from "@/lib/shipping/display";
import type { RateDto, ZoneDto } from "@/lib/shipping/zones";
import type { Dictionary } from "@/messages/en";
import type { QuickSetupCountry } from "@/lib/shipping/quick-setup";
import { QuickSetup } from "./quick-setup";
import { RateDialogContent } from "./rate-dialog";
import { ZoneDialogContent } from "./zone-dialog";

const INITIAL_STATE: FormState = { status: "idle" };

type DialogState =
  | { readonly kind: "zone"; readonly zone: ZoneDto | null }
  | { readonly kind: "rate"; readonly zoneId: string; readonly rate: RateDto | null };

/** A delete button that asks first, then posts through a server action. */
function DeleteForm({
  action,
  fields,
  confirm,
  label,
}: {
  readonly action: (previous: FormState, formData: FormData) => Promise<FormState>;
  readonly fields: Readonly<Record<string, string>>;
  readonly confirm: string;
  readonly label: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant="ghost" size="sm" loading={isPending}>
        {label}
      </Button>
      {state.status === "error" && (
        <span role="alert" className="text-destructive text-xs">
          {state.message}
        </span>
      )}
    </form>
  );
}

function ZoneSection({
  zone,
  currency,
  weightUnit,
  t,
  locale,
  onDialog,
}: {
  readonly zone: ZoneDto;
  readonly currency: string;
  readonly weightUnit: WeightUnit;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly onDialog: (dialog: DialogState) => void;
}) {
  const copy = t.shippingSettings;
  const headingId = useId();
  const describe = { locale, currency, weightUnit, t: copy, units: t.productEditor } as const;

  return (
    <section aria-labelledby={headingId} className="border-border flex flex-col gap-3 border-t p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={headingId} className="text-base font-semibold">
            {zone.name}
          </h3>
          <p className="text-muted-foreground text-sm">
            {zone.countries.map((country) => summarizeCountry(country, locale, copy)).join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDialog({ kind: "zone", zone })}
          >
            {copy.editZone}
          </Button>
          <DeleteForm
            action={deleteZoneAction}
            fields={{ zoneId: zone.id }}
            confirm={copy.confirmDeleteZone.replace("{name}", zone.name)}
            label={copy.deleteZone}
          />
        </div>
      </div>

      {zone.rates.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.noRates}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table aria-label={`${zone.name}: ${copy.rates}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.rateName}</TableHead>
                <TableHead>{copy.condition}</TableHead>
                <TableHead className="text-end">{copy.price}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {zone.rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-medium">
                    {rate.name}
                    {rate.description !== null && (
                      <span className="text-muted-foreground block text-xs font-normal">
                        {rate.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{describeCondition(rate.condition, describe)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatRatePrice(rate.priceMinor, currency, locale, copy)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDialog({ kind: "rate", zoneId: zone.id, rate })}
                      >
                        {copy.edit}
                      </Button>
                      <DeleteForm
                        action={deleteRateAction}
                        fields={{ zoneId: zone.id, rateId: rate.id }}
                        confirm={copy.confirmDeleteRate.replace("{name}", rate.name)}
                        label={copy.deleteRate}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDialog({ kind: "rate", zoneId: zone.id, rate: null })}
        >
          {copy.addRate}
        </Button>
      </div>
    </section>
  );
}

/**
 * Plan 3C — Settings → Shipping and delivery, "General shipping rates": every zone with the countries
 * it covers and its rates, and the dialogs to create or edit a zone and add or edit a rate. Prices and
 * conditions are shown in the store currency and weight unit.
 */
export function ZonesView({
  zones,
  currency,
  weightUnit,
  homeCountry,
  t,
  locale,
}: {
  readonly zones: readonly ZoneDto[];
  readonly currency: string;
  readonly weightUnit: WeightUnit;
  /** The store's own country, from its currency (Plan 3E). */
  readonly homeCountry: QuickSetupCountry;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.shippingSettings;
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = useCallback(() => setDialog(null), []);

  return (
    <>
      {zones.length === 0 && (
        <QuickSetup homeCountry={homeCountry} currency={currency} t={t} locale={locale} />
      )}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{copy.generalRates}</CardTitle>
            <CardDescription>{copy.generalRatesBody}</CardDescription>
          </div>
          <Button type="button" onClick={() => setDialog({ kind: "zone", zone: null })}>
            {copy.createZone}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {zones.length === 0 ? (
            <p className="text-muted-foreground border-border border-t p-4 text-sm">
              {copy.emptyState}
            </p>
          ) : (
            zones.map((zone) => (
              <ZoneSection
                key={zone.id}
                zone={zone}
                currency={currency}
                weightUnit={weightUnit}
                t={t}
                locale={locale}
                onDialog={setDialog}
              />
            ))
          )}
        </CardContent>

        <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
          {dialog?.kind === "zone" && (
            <ZoneDialogContent
              key={dialog.zone?.id ?? "new"}
              zone={dialog.zone}
              zones={zones}
              onClose={close}
              t={t}
              locale={locale}
            />
          )}
          {dialog?.kind === "rate" && (
            <RateDialogContent
              key={`${dialog.zoneId}:${dialog.rate?.id ?? "new"}`}
              zoneId={dialog.zoneId}
              rate={dialog.rate}
              currency={currency}
              weightUnit={weightUnit}
              onClose={close}
              t={t}
              locale={locale}
            />
          )}
        </Dialog>
      </Card>
    </>
  );
}
