"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, CardContent } from "@platform/ui";
import { saveTaxFlagsAction } from "@/app/settings/taxes/actions";
import { Switch } from "@/components/products/editor/controls";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface Flags {
  readonly pricesIncludeTax: boolean;
  readonly chargeTaxOnShipping: boolean;
}

/**
 * Plan 3C — Shopify's two tax switches: "All prices include tax" and "Charge tax on shipping rates".
 * Save stays off until a switch differs from what was last saved (the product editor's rule).
 */
export function TaxFlagsForm({
  pricesIncludeTax,
  chargeTaxOnShipping,
  t,
}: Flags & { readonly t: Dictionary }) {
  const copy = t.taxSettings;
  const [state, formAction, isPending] = useActionState(saveTaxFlagsAction, INITIAL_STATE);
  const [flags, setFlags] = useState<Flags>({ pricesIncludeTax, chargeTaxOnShipping });
  const [saved, setSaved] = useState<Flags>({ pricesIncludeTax, chargeTaxOnShipping });
  const submitted = useRef<Flags | null>(null);

  // A fresh read from the server (after Save, or a reload) is the new "what was saved".
  useEffect(() => {
    const fresh = { pricesIncludeTax, chargeTaxOnShipping };
    setFlags(fresh);
    setSaved(fresh);
  }, [pricesIncludeTax, chargeTaxOnShipping]);

  // A successful Save makes what was submitted the saved state at once, before the page refreshes.
  useEffect(() => {
    if (state.status === "success" && submitted.current !== null) setSaved(submitted.current);
  }, [state]);

  const dirty =
    flags.pricesIncludeTax !== saved.pricesIncludeTax ||
    flags.chargeTaxOnShipping !== saved.chargeTaxOnShipping;

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = flags;
      }}
      className="flex flex-col gap-4"
    >
      <Card>
        <CardContent className="divide-border flex flex-col divide-y p-0">
          <div className="flex flex-col gap-1 p-4">
            <Switch
              name="pricesIncludeTax"
              label={copy.pricesIncludeTax}
              checked={flags.pricesIncludeTax}
              onCheckedChange={(next) =>
                setFlags((current) => ({ ...current, pricesIncludeTax: next }))
              }
              className="font-medium"
            />
            <p className="text-muted-foreground text-sm">{copy.pricesIncludeTaxHint}</p>
          </div>
          <div className="flex flex-col gap-1 p-4">
            <Switch
              name="chargeTaxOnShipping"
              label={copy.chargeShipping}
              checked={flags.chargeTaxOnShipping}
              onCheckedChange={(next) =>
                setFlags((current) => ({ ...current, chargeTaxOnShipping: next }))
              }
              className="font-medium"
            />
            <p className="text-muted-foreground text-sm">{copy.chargeShippingHint}</p>
          </div>
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
