"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, Switch } from "@platform/ui";
import { changeMarketingConsentAction } from "@/app/customers/actions";
import type { Dictionary } from "@/messages/en";

type Channel = "email" | "sms";

/**
 * Email and SMS marketing per customer. The state is what staff last recorded — an assertion, not
 * proof that the shopper opted in, and the card says so. Operators and up get a switch per channel
 * (one channel changes at a time; the other is untouched); viewers and unknown roles see the same
 * state as read-only text. A refused change puts the switch back.
 */
export function CustomerMarketingCard({
  customerId,
  marketing,
  canEdit,
  t,
}: {
  readonly customerId: string;
  readonly marketing: { readonly email: boolean; readonly sms: boolean };
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  const m = t.customerDetail.marketing;
  const baseId = useId();
  const [value, setValue] = useState(marketing);
  const [busy, setBusy] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startChanging] = useTransition();

  // The page re-renders with the recorded state after a change.
  useEffect(() => {
    setValue({ email: marketing.email, sms: marketing.sms });
  }, [marketing.email, marketing.sms]);

  function change(channel: Channel, subscribed: boolean): void {
    const previous = value[channel];
    setValue((current) => ({ ...current, [channel]: subscribed }));
    setBusy(channel);
    setError(null);
    startChanging(async () => {
      try {
        const state = await changeMarketingConsentAction(customerId, channel, subscribed);
        if (state.status === "error") {
          setValue((current) => ({ ...current, [channel]: previous }));
          setError(state.message);
        }
      } catch {
        setValue((current) => ({ ...current, [channel]: previous }));
        setError(t.formErrors.unexpected);
      } finally {
        setBusy(null);
      }
    });
  }

  const rows: readonly {
    readonly channel: Channel;
    readonly label: string;
    readonly subscribed: string;
  }[] = [
    { channel: "email", label: m.emailLabel, subscribed: m.emailSubscribed },
    { channel: "sms", label: m.smsLabel, subscribed: m.smsSubscribed },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => {
          const on = value[row.channel];
          const statusId = `${baseId}-${row.channel}`;
          return (
            <div key={row.channel} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p id={statusId} className="text-muted-foreground text-sm">
                  {on ? row.subscribed : m.notSubscribed}
                </p>
              </div>
              {canEdit && (
                <Switch
                  checked={on}
                  disabled={busy !== null}
                  aria-label={row.label}
                  aria-describedby={statusId}
                  onCheckedChange={(next) => change(row.channel, next)}
                />
              )}
            </div>
          );
        })}
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-xs">{m.note}</p>
      </CardContent>
    </Card>
  );
}
