"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { PAGE_TITLE_MAX, RICH_TEXT_MAX, type LocalizedText } from "@platform/storefront-content";
import { createPageAction } from "@/app/pages/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Locale } from "@/lib/i18n";
import { settleAction } from "@/lib/online-store/settle-action";
import { randomRouteToken, routePathFromTitle } from "@/lib/pages/route-path";
import type { Dictionary } from "@/messages/en";
import { LocalizedTextField } from "@/components/online-store/localized-text-field";
import { RichTextEditor } from "@/components/online-store/rich-text-editor";

const INITIAL_STATE: FormState = { status: "idle" };

const hasText = (text: LocalizedText) =>
  (text.ar ?? "").trim() !== "" || (text.en ?? "").trim() !== "";

/**
 * "Add page" (spec 2.4, Ruling 17): the title, the content and the page address in one call. The
 * address follows the title (`routePathFromTitle`, Ruling 19) until the merchant edits it; an
 * Arabic-only title keeps one random `page-<4>` suffix while it is typed. The template, experience,
 * SEO-profile and locale references are no longer asked here (the API still accepts them).
 */
export function PageCreateForm({ t, locale }: { readonly t: Dictionary; readonly locale: Locale }) {
  const e = t.pageEditor;
  const formId = useId();
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const [address, setAddress] = useState("");
  const [addressEdited, setAddressEdited] = useState(false);
  // Drawn on the first title change (an event, so the server and client renders agree).
  const token = useRef<string | null>(null);
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  const onTitle = (title: LocalizedText) => {
    if (addressEdited) return;
    if (!hasText(title)) {
      setAddress("");
      return;
    }
    setAddress(
      routePathFromTitle(title, () => {
        token.current ??= randomRouteToken();
        return token.current;
      }),
    );
  };

  /**
   * Runs inside a transition, as `useActionState` would (review M-8): the redirect to the new page
   * that `settleAction` rethrows is then handled by Next's router boundary instead of escaping as
   * an unhandled rejection. Any other failure is our own copy.
   */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await settleAction(() => createPageAction(state, data), {
        status: "error",
        message: t.formErrors.unexpected,
        fieldErrors: {},
      } satisfies FormState);
      startTransition(() => setState(result));
    });
  };

  const addressId = `${formId}-routePath`;
  const hintId = `${addressId}-hint`;
  const errorId = `${addressId}-error`;
  const addressError = fieldErrors["routePath"];

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <LocalizedTextField
        t={t}
        locale={locale}
        name="title"
        label={e.title}
        max={PAGE_TITLE_MAX}
        value={{}}
        errors={fieldErrors}
        onChange={onTitle}
      />

      <RichTextEditor
        t={t}
        locale={locale}
        name="body"
        label={e.content}
        value={{}}
        max={RICH_TEXT_MAX.body}
        errors={fieldErrors}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={addressId}>{e.address}</Label>
        <Input
          id={addressId}
          name="routePath"
          dir="ltr"
          value={address}
          placeholder="/pages/about-us"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={addressError !== undefined || undefined}
          aria-describedby={addressError === undefined ? hintId : `${errorId} ${hintId}`}
          onChange={(event) => {
            setAddress(event.currentTarget.value);
            setAddressEdited(true);
          }}
        />
        <p id={hintId} className="text-muted-foreground text-xs">
          {e.addressHint}
        </p>
        {addressError !== undefined && (
          <p id={errorId} className="text-destructive text-sm">
            {addressError}
          </p>
        )}
      </div>

      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? t.pageCreate.submitting : t.pageCreate.submit}
        </Button>
      </div>
    </form>
  );
}
