"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, CardContent } from "@platform/ui";
import { savePaymentMethodsAction } from "@/app/settings/payments/actions";
import { Switch } from "@/components/products/editor/controls";
import type { PaymentSettingsDto } from "@/lib/api/payments";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The methods the page names itself, in the order merchants expect; any other key follows alphabetically. */
const KNOWN_ORDER = ["cod", "paymob", "stripe"] as const;

function orderedKeys(methods: PaymentSettingsDto["methods"]): string[] {
  const keys = Object.keys(methods);
  const known = KNOWN_ORDER.filter((key) => keys.includes(key));
  const others = keys.filter((key) => !(KNOWN_ORDER as readonly string[]).includes(key)).sort();
  return [...known, ...others];
}

/** An order-free fingerprint of a set of methods — two equal fingerprints mean nothing changed. */
function fingerprint(methods: Iterable<string>): string {
  return JSON.stringify([...methods].sort());
}

function describeMethod(
  key: string,
  t: Dictionary["paymentSettings"],
): { readonly label: string; readonly description: string | null } {
  if (key === "cod") return { label: t.methodCod, description: t.methodCodDescription };
  if (key === "stripe") return { label: t.methodStripe, description: t.methodStripeDescription };
  if (key === "paymob") return { label: t.methodPaymob, description: t.methodPaymobDescription };
  return { label: key, description: null };
}

/**
 * Plan 3A — one switch per registered payment method, one Save. Save stays off until a switch differs
 * from what was last saved (the product editor's rule), and the last method on cannot be turned off.
 * A method the merchant cannot change (not on this platform yet, or it needs setup) is shown
 * disabled with the reason; if it is currently on it is still submitted, so saving never drops it.
 */
export function PaymentMethodsForm({
  settings,
  t,
}: {
  readonly settings: PaymentSettingsDto;
  readonly t: Dictionary;
}) {
  const copy = t.paymentSettings;
  const [state, formAction, isPending] = useActionState(savePaymentMethodsAction, INITIAL_STATE);
  const [on, setOn] = useState<ReadonlySet<string>>(() => new Set(settings.enabledMethods));
  const [saved, setSaved] = useState(() => fingerprint(settings.enabledMethods));
  const [refused, setRefused] = useState(false);
  const submitted = useRef<string | null>(null);

  // A fresh read from the server (after Save, or a reload) is the new "what was saved".
  useEffect(() => {
    setOn(new Set(settings.enabledMethods));
    setSaved(fingerprint(settings.enabledMethods));
  }, [settings]);

  // A successful Save makes what was submitted the saved state at once, before the page refreshes.
  useEffect(() => {
    if (state.status === "success" && submitted.current !== null) setSaved(submitted.current);
  }, [state]);

  const keys = orderedKeys(settings.methods);
  const dirty = fingerprint(on) !== saved;

  function toggle(key: string, next: boolean): void {
    if (!next && on.size === 1 && on.has(key)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    setOn((current) => {
      const updated = new Set(current);
      if (next) updated.add(key);
      else updated.delete(key);
      return updated;
    });
  }

  if (keys.length === 0) {
    return <p className="text-muted-foreground text-sm">{copy.noMethods}</p>;
  }

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = fingerprint(on);
      }}
      className="flex flex-col gap-4"
    >
      <Card>
        <CardContent className="divide-border flex flex-col divide-y p-0">
          {keys.map((key) => {
            const info = settings.methods[key];
            const { label, description } = describeMethod(key, copy);
            const reason =
              info?.available === false
                ? copy.notAvailable
                : info?.configured === false
                  ? copy.needsSetup
                  : null;
            const locked = reason !== null;
            const reasonId = `payment-method-${key}-reason`;
            return (
              <div key={key} className="flex flex-col gap-1 p-4">
                <Switch
                  label={label}
                  value={key}
                  checked={on.has(key)}
                  // A locked row is disabled, and a disabled input posts nothing: the hidden field
                  // below carries a locked method that is currently on.
                  name={locked ? undefined : "method"}
                  disabled={locked}
                  aria-describedby={reason === null ? undefined : reasonId}
                  onCheckedChange={(next) => toggle(key, next)}
                  className="font-medium"
                />
                {locked && on.has(key) && <input type="hidden" name="method" value={key} />}
                {description !== null && (
                  <p className="text-muted-foreground text-sm">{description}</p>
                )}
                {reason !== null && (
                  <p id={reasonId} className="text-muted-foreground text-sm">
                    {reason}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {refused && (
          <p role="alert" className="text-destructive me-auto text-sm">
            {copy.keepOne}
          </p>
        )}
        {state.status === "error" && !refused && (
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
