"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@platform/ui";
import { unlockAction, type UnlockState } from "@/app/(gate)/password/actions";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL: UnlockState = { status: "idle" };

export function PasswordFormView({
  t,
  locale,
  returnTo,
  state,
  action,
  pending,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly returnTo: string;
  readonly state: UnlockState;
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const error =
    state.status === "incorrect"
      ? t.password.incorrect
      : state.status === "unavailable"
        ? t.password.unavailable
        : state.status === "rate_limited"
          ? t.password.tooMany.replace(
              "{minutes}",
              new Intl.NumberFormat(locale).format(state.minutes),
            )
          : null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="return_to" value={returnTo} />
      <Label htmlFor="storefront-password">{t.password.label}</Label>
      <Input
        id="storefront-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={100}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : "storefront-password-error"}
      />
      {error === null ? null : (
        <p id="storefront-password-error" role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending}>
        {t.password.submit}
      </Button>
    </form>
  );
}

export function PasswordForm(props: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly returnTo: string;
}) {
  const [state, action, pending] = useActionState(unlockAction, INITIAL);
  return <PasswordFormView {...props} state={state} action={action} pending={pending} />;
}
