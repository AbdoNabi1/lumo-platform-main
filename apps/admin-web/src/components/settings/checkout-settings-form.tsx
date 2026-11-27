"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { saveCheckoutSettingsAction } from "@/app/settings/checkout/actions";
import { Field } from "@/components/products/editor/field";
import { Switch } from "@/components/products/editor/controls";
import type { CheckoutSettingsDto } from "@/lib/api/checkout-settings";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";
import {
  CART_LINE_LIMIT_MAX,
  CART_LINE_LIMIT_MIN,
  type Line2Mode,
  type MarketingEmailPrompt,
  type NameMode,
  type PhoneMode,
} from "@/lib/checkout-settings-model";
import type { Dictionary } from "@/messages/en";
import { ChoiceGroup } from "./choice-group";

const INITIAL_STATE: CheckoutSettingsSaveState = { status: "idle" };
const NO_ERRORS: Readonly<Record<string, string>> = {};

interface Draft {
  readonly nameMode: NameMode;
  readonly phoneMode: PhoneMode;
  readonly line2Mode: Line2Mode;
  readonly marketingEmailPrompt: MarketingEmailPrompt;
  readonly requireLogin: boolean;
  readonly limitOn: boolean;
  /** What is typed in the limit box; "" when there is no limit. */
  readonly limitText: string;
}

function draftOf(settings: CheckoutSettingsDto): Draft {
  return {
    nameMode: settings.nameMode,
    phoneMode: settings.phoneMode,
    line2Mode: settings.line2Mode,
    marketingEmailPrompt: settings.marketingEmailPrompt,
    requireLogin: settings.requireLogin,
    limitOn: settings.cartLineLimit !== null,
    limitText: settings.cartLineLimit === null ? "" : String(settings.cartLineLimit),
  };
}

/** Two drafts are the same save: a limit that is off ignores whatever is typed in its box. */
function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.nameMode === b.nameMode &&
    a.phoneMode === b.phoneMode &&
    a.line2Mode === b.line2Mode &&
    a.marketingEmailPrompt === b.marketingEmailPrompt &&
    a.requireLogin === b.requireLogin &&
    a.limitOn === b.limitOn &&
    (!a.limitOn || a.limitText.trim() === b.limitText.trim())
  );
}

/**
 * Wave 2a - Settings → Checkout, grouped the way Shopify's page is: Customer information, Marketing
 * options, sign-in, Advanced (the add-to-cart limit). Save stays off until something differs from
 * what was last saved. It sends the version the page loaded: if someone else saved since, the
 * server answers 409 and the newer settings replace the form. Require sign-in is off and disabled
 * while Customer accounts are off (D37), with the reason.
 */
export function CheckoutSettingsForm({
  settings,
  t,
}: {
  readonly settings: CheckoutSettingsDto;
  readonly t: Dictionary;
}) {
  const copy = t.checkoutSettings;
  const [state, formAction, isPending] = useActionState(saveCheckoutSettingsAction, INITIAL_STATE);
  const [saved, setSaved] = useState(() => ({
    draft: draftOf(settings),
    version: settings.version,
  }));
  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [seen, setSeen] = useState(settings);
  const submitted = useRef<Draft | null>(null);

  // A newer version from the server (someone else saved; a reload) replaces the form. The same
  // version coming back after our own save, or a refused save, leaves what was typed alone.
  if (settings !== seen) {
    setSeen(settings);
    if (settings.version !== saved.version) {
      setSaved({ draft: draftOf(settings), version: settings.version });
      setDraft(draftOf(settings));
    }
  }

  // A successful Save makes what was submitted the saved state at once, with its new version.
  useEffect(() => {
    if (state.status === "success" && "version" in state && submitted.current !== null) {
      setSaved({ draft: submitted.current, version: state.version });
    }
  }, [state]);

  const accountsOff = settings.accountsMode === "disabled";
  const dirty = !sameDraft(draft, saved.draft);
  const errors = state.status === "error" ? state.fieldErrors : NO_ERRORS;
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <form
      action={formAction}
      // The server action refuses a bad limit with a message in the page's language; the browser's
      // own bubble (min/max) would block the submit with one in the browser's.
      noValidate
      onSubmit={() => {
        submitted.current = draft;
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="expectedVersion" value={saved.version ?? ""} />

      <Card>
        <CardHeader>
          <CardTitle>{copy.customerInfoTitle}</CardTitle>
          <p className="text-muted-foreground text-sm">{copy.customerInfoHint}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ChoiceGroup
            legend={copy.nameLegend}
            name="nameMode"
            value={draft.nameMode}
            onChange={(nameMode) => set({ nameMode })}
            error={errors["nameMode"]}
            options={[
              { value: "required", label: copy.nameRequired, hint: copy.nameRequiredHint },
              { value: "optional", label: copy.nameOptional, hint: copy.nameOptionalHint },
            ]}
          />
          <ChoiceGroup
            legend={copy.phoneLegend}
            name="phoneMode"
            value={draft.phoneMode}
            onChange={(phoneMode) => set({ phoneMode })}
            error={errors["phoneMode"]}
            footer={copy.phoneNoHide}
            options={[
              { value: "required", label: copy.phoneRequired, hint: copy.phoneRequiredHint },
              { value: "optional", label: copy.phoneOptional, hint: copy.phoneOptionalHint },
            ]}
          />
          <ChoiceGroup
            legend={copy.line2Legend}
            name="line2Mode"
            value={draft.line2Mode}
            onChange={(line2Mode) => set({ line2Mode })}
            error={errors["line2Mode"]}
            options={[
              { value: "hidden", label: copy.line2Hidden, hint: copy.line2HiddenHint },
              { value: "optional", label: copy.line2Optional, hint: copy.line2OptionalHint },
              { value: "required", label: copy.line2Required, hint: copy.line2RequiredHint },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.marketingTitle}</CardTitle>
          <p className="text-muted-foreground text-sm">{copy.marketingHint}</p>
        </CardHeader>
        <CardContent>
          <ChoiceGroup
            legend={copy.marketingLegend}
            name="marketingEmailPrompt"
            value={draft.marketingEmailPrompt}
            onChange={(marketingEmailPrompt) => set({ marketingEmailPrompt })}
            error={errors["marketingEmailPrompt"]}
            options={[
              { value: "hidden", label: copy.marketingHidden, hint: copy.marketingHiddenHint },
              { value: "show", label: copy.marketingShow, hint: copy.marketingShowHint },
              {
                value: "preselect",
                label: copy.marketingPreselect,
                hint: copy.marketingPreselectHint,
                note: copy.marketingPreselectWarning,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.accountsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <Switch
            label={copy.requireLoginLabel}
            name="requireLogin"
            checked={draft.requireLogin && !accountsOff}
            disabled={accountsOff}
            aria-describedby="require-login-hint"
            onCheckedChange={(requireLogin) => set({ requireLogin })}
            className="font-medium"
          />
          <p id="require-login-hint" className="text-muted-foreground text-sm">
            {accountsOff ? copy.requireLoginOffReason : copy.requireLoginHint}
          </p>
          {accountsOff && (
            <Link
              href="/settings/customer-accounts"
              className="text-foreground text-sm font-medium hover:underline"
            >
              {copy.accountsLink}
            </Link>
          )}
          {errors["requireLogin"] !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {errors["requireLogin"]}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.advancedTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Switch
            label={copy.limitLabel}
            name="cartLimitOn"
            checked={draft.limitOn}
            aria-describedby="cart-limit-hint"
            onCheckedChange={(limitOn) => set({ limitOn })}
            className="font-medium"
          />
          <p id="cart-limit-hint" className="text-muted-foreground text-sm">
            {copy.limitHint}
          </p>
          {draft.limitOn && (
            <Field
              label={copy.limitInputLabel}
              name="cartLineLimit"
              error={errors["cartLineLimit"]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={CART_LINE_LIMIT_MIN}
                  max={CART_LINE_LIMIT_MAX}
                  step={1}
                  className="max-w-40"
                  value={draft.limitText}
                  onChange={(event) => set({ limitText: event.target.value })}
                />
              )}
            </Field>
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
