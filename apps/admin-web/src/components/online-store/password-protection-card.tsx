"use client";

import { useActionState, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@platform/ui";
import {
  saveAccessAction,
  type OnlineStoreSaveState,
} from "@/app/online-store/preferences/actions";
import type { AccessDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { LocalizedTextField } from "./localized-text-field";
import { SaveStatus } from "./save-status";

const IDLE: OnlineStoreSaveState = { status: "idle" };
const NO_ERRORS: Readonly<Record<string, string>> = {};

/**
 * Admin-only lock (Decision 9). Others see the same card read-only, with the reason. The password
 * field never pre-fills and can only be replaced (Ruling 10): whether one is set comes from the
 * DTO's flag, and the field is empty again after every save (React resets the form's uncontrolled
 * fields after an action).
 */
export function PasswordProtectionCard({
  t,
  locale,
  access,
  isAdmin,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly access: AccessDto;
  readonly isAdmin: boolean;
}) {
  const p = t.onlineStorePreferences;
  const [state, action, pending] = useActionState(saveAccessAction, IDLE);
  const [locked, setLocked] = useState(access.locked);
  const errors = state.status === "error" ? state.fieldErrors : NO_ERRORS;
  const passwordError = errors["password"];
  const setOn =
    access.passwordUpdatedAt === null
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(access.passwordUpdatedAt),
        );
  const passwordStatus = !access.passwordSet
    ? p.passwordNotSet
    : setOn === null
      ? p.passwordSet
      : p.passwordSetOn.replace("{date}", setOn);
  return (
    <form action={action}>
      <input type="hidden" name="expectedVersion" value={access.version} />
      <Card>
        <CardHeader>
          <CardTitle>{p.passwordCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch
              name="locked"
              checked={locked}
              onCheckedChange={setLocked}
              disabled={!isAdmin}
              aria-describedby={isAdmin ? undefined : "storefront-access-admin-only"}
            />
            {p.lockSwitch}
          </label>
          <p className="text-muted-foreground text-sm">{passwordStatus}</p>
          {isAdmin ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="storefront-password">{p.newPassword}</Label>
              <Input
                id="storefront-password"
                name="password"
                type="password"
                autoComplete="new-password"
                defaultValue=""
                maxLength={100}
                aria-invalid={passwordError !== undefined || undefined}
                aria-describedby="storefront-password-hint"
              />
              <p
                id="storefront-password-hint"
                className={
                  passwordError === undefined
                    ? "text-muted-foreground text-xs"
                    : "text-destructive text-xs"
                }
              >
                {passwordError ?? p.passwordHint}
              </p>
            </div>
          ) : null}
          <LocalizedTextField
            t={t}
            locale={locale}
            name="message"
            label={p.visitorMessage}
            max={500}
            value={access.message}
            multiline
            disabled={!isAdmin}
            errors={errors}
          />
          <p id="storefront-access-admin-only" className="text-muted-foreground text-xs">
            {isAdmin ? p.accessNote : p.adminOnly}
          </p>
          <SaveStatus t={t} state={state} />
          {isAdmin ? (
            <div className="flex justify-end">
              <Button type="submit" loading={pending}>
                {pending ? p.saving : p.save}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}
