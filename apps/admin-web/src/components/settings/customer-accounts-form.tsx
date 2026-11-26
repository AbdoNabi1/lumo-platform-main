"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { saveCustomerAccountsAction } from "@/app/settings/customer-accounts/actions";
import { Switch } from "@/components/products/editor/controls";
import type { CheckoutSettingsDto } from "@/lib/api/checkout-settings";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";
import type { AccountsMode } from "@/lib/checkout-settings-model";
import type { Dictionary } from "@/messages/en";
import { ChoiceGroup } from "./choice-group";

const INITIAL_STATE: CheckoutSettingsSaveState = { status: "idle" };
const NO_ERRORS: Readonly<Record<string, string>> = {};

interface Draft {
  readonly accountsMode: AccountsMode;
  readonly showAccountLink: boolean;
}

function draftOf(settings: CheckoutSettingsDto): Draft {
  return { accountsMode: settings.accountsMode, showAccountLink: settings.showAccountLink };
}

/**
 * Wave 2a - Settings → Customer accounts: accounts on or off (D37: what turning them off does), and
 * whether the account link shows in the store header and checkout. Save sends the version the page
 * loaded; a 409 replaces the form with the newer settings. "Off" is disabled while sign-in is
 * required at checkout (the server refuses it too, with a 422 on `requireLogin` that is shown).
 */
export function CustomerAccountsForm({
  settings,
  t,
}: {
  readonly settings: CheckoutSettingsDto;
  readonly t: Dictionary;
}) {
  const copy = t.customerAccountSettings;
  const [state, formAction, isPending] = useActionState(saveCustomerAccountsAction, INITIAL_STATE);
  const [saved, setSaved] = useState(() => ({
    draft: draftOf(settings),
    version: settings.version,
  }));
  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [seen, setSeen] = useState(settings);
  const submitted = useRef<Draft | null>(null);

  // Same rule as the Checkout form: only a newer version from the server replaces what was typed.
  if (settings !== seen) {
    setSeen(settings);
    if (settings.version !== saved.version) {
      setSaved({ draft: draftOf(settings), version: settings.version });
      setDraft(draftOf(settings));
    }
  }

  useEffect(() => {
    if (state.status === "success" && "version" in state && submitted.current !== null) {
      setSaved({ draft: submitted.current, version: state.version });
    }
  }, [state]);

  const dirty =
    draft.accountsMode !== saved.draft.accountsMode ||
    draft.showAccountLink !== saved.draft.showAccountLink;
  const errors = state.status === "error" ? state.fieldErrors : NO_ERRORS;
  const loginRequired = settings.requireLogin;

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = draft;
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="expectedVersion" value={saved.version ?? ""} />

      <Card>
        <CardHeader>
          <CardTitle>{copy.accountsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChoiceGroup
            legend={copy.accountsLegend}
            name="accountsMode"
            value={draft.accountsMode}
            onChange={(accountsMode) => setDraft((current) => ({ ...current, accountsMode }))}
            error={errors["accountsMode"] ?? errors["requireLogin"]}
            options={[
              { value: "optional", label: copy.accountsOn, hint: copy.accountsOnHint },
              {
                value: "disabled",
                label: copy.accountsOff,
                hint: copy.accountsOffHint,
                disabled: loginRequired,
                reason: loginRequired ? (
                  <>
                    {copy.requireLoginBlocked}{" "}
                    <Link
                      href="/settings/checkout"
                      className="text-foreground font-medium hover:underline"
                    >
                      {copy.checkoutLink}
                    </Link>
                  </>
                ) : undefined,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.linkTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <Switch
            label={copy.showLinkLabel}
            name="showAccountLink"
            checked={draft.showAccountLink}
            aria-describedby="show-link-hint"
            onCheckedChange={(showAccountLink) =>
              setDraft((current) => ({ ...current, showAccountLink }))
            }
            className="font-medium"
          />
          <p id="show-link-hint" className="text-muted-foreground text-sm">
            {copy.showLinkHint}
            {draft.accountsMode === "disabled" ? ` ${copy.showLinkOffNote}` : ""}
          </p>
          {errors["showAccountLink"] !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {errors["showAccountLink"]}
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">{copy.notAvailableYet}</p>

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
