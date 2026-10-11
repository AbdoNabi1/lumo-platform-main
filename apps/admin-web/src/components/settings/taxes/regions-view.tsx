"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
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
import { deleteRegionAction } from "@/app/settings/taxes/actions";
import type { FormState } from "@/lib/api/mutation";
import type { TaxRegionDto } from "@/lib/api/taxes";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import { basisPointsToPercent } from "@/lib/taxes/rates";
import type { Dictionary } from "@/messages/en";
import { RegionDialogContent } from "./region-dialog";

const INITIAL_STATE: FormState = { status: "idle" };

function DeleteRegionForm({
  region,
  t,
  locale,
}: {
  readonly region: TaxRegionDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.taxSettings;
  const [state, formAction, isPending] = useActionState(deleteRegionAction, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const message = copy.confirmDeleteRegion.replace(
          "{country}",
          countryName(region.countryCode, locale),
        );
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="country" value={region.countryCode} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending}>
        {copy.deleteRegion}
      </Button>
      {state.status === "error" && (
        <span role="alert" className="text-destructive text-xs">
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * Plan 3C — Settings → Taxes and duties, "Regions": the countries where tax is collected with their
 * rate and how many province rates replace it, and the dialog to add or edit one. No region means no
 * tax at checkout.
 */
export function RegionsView({
  regions,
  t,
  locale,
}: {
  readonly regions: readonly TaxRegionDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.taxSettings;
  const [dialog, setDialog] = useState<{ readonly region: TaxRegionDto | null } | null>(null);
  const close = useCallback(() => setDialog(null), []);
  const existing = useMemo(() => new Set(regions.map((r) => r.countryCode)), [regions]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{copy.regions}</CardTitle>
          <CardDescription>{copy.regionsBody}</CardDescription>
        </div>
        <Button type="button" onClick={() => setDialog({ region: null })}>
          {copy.addRegion}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {regions.length === 0 ? (
          <p className="text-muted-foreground border-border border-t p-4 text-sm">
            {copy.emptyState}
          </p>
        ) : (
          <Table aria-label={copy.regions}>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.country}</TableHead>
                <TableHead className="text-end">{copy.rate}</TableHead>
                <TableHead>{copy.overrides}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {regions.map((region) => (
                <TableRow key={region.countryCode}>
                  <TableCell className="font-medium">
                    {countryName(region.countryCode, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {basisPointsToPercent(region.rateBasisPoints)}%
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {region.provinces.length === 0
                      ? copy.noOverrides
                      : copy.overridesCount.replace("{n}", String(region.provinces.length))}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ region })}
                      >
                        {copy.edit}
                      </Button>
                      <DeleteRegionForm region={region} t={t} locale={locale} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        {dialog !== null && (
          <RegionDialogContent
            key={dialog.region?.countryCode ?? "new"}
            region={dialog.region}
            existing={existing}
            onClose={close}
            t={t}
            locale={locale}
          />
        )}
      </Dialog>
    </Card>
  );
}
