"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Input, Label, Textarea } from "@platform/ui";
import { submitLead, type LeadFormInput } from "@/app/(store)/lead-actions";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { BUTTON_CLASS } from "./section-styles";

type LeadField = "name" | "phone" | "email" | "message";

type Failure =
  | { readonly reason: "validation"; readonly fields: readonly LeadField[] }
  | { readonly reason: "rate_limited" | "unavailable" | "network" };

/** The route's own limits (`leads.use-cases.ts`); a longer value would only come back as a 422. */
const MAX_NAME = 120;
const MAX_PHONE = 32;
const MAX_EMAIL = 320;
const MAX_MESSAGE = 2000;

/**
 * The lead form's fields (Lead Site Part C, Task 6). Trap and timing signals (honeypot, time
 * since the form appeared) go to `submitLead`, which treats a filled trap or a too-fast submit as
 * spam; the visitor sees the same success either way. `submissionKey` is one per attempt: a
 * failed submit keeps it so a retry (or a double click) can never save the lead twice, and it is
 * minted again after a success.
 */
export function LeadFormFields({
  formId,
  locale,
  copy,
  submitLabel,
  successMessage,
  showEmail,
  showMessage,
  labelledBy,
}: {
  readonly formId: string;
  readonly locale: Locale;
  readonly copy: Dictionary["leadForm"];
  /** Already resolved (merchant text in the visitor's language, else the dictionary default). */
  readonly submitLabel: string;
  readonly successMessage: string;
  readonly showEmail: boolean;
  readonly showMessage: boolean;
  /** The id of the section heading that names this form, when it has one. */
  readonly labelledBy?: string;
}) {
  const uid = useId();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submissionKey, setSubmissionKey] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState(false);
  const shownAt = useRef<number | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    shownAt.current = Date.now();
    setSubmissionKey(crypto.randomUUID());
  }, []);

  // Focus never stays on the button that just disappeared (finding 14).
  useEffect(() => {
    if (done) statusRef.current?.focus();
  }, [done]);

  const labels: Readonly<Record<LeadField, string>> = {
    name: copy.name,
    phone: copy.phone,
    email: copy.email,
    message: copy.message,
  };
  const shown: readonly LeadField[] = [
    "name",
    "phone",
    ...(showEmail ? (["email"] as const) : []),
    ...(showMessage ? (["message"] as const) : []),
  ];
  const invalid: readonly LeadField[] =
    failure?.reason === "validation" ? failure.fields.filter((f) => shown.includes(f)) : [];
  const errorId = `${uid}-error`;
  const fieldError = (field: LeadField) =>
    invalid.includes(field) ? ({ "aria-invalid": true, "aria-describedby": errorId } as const) : {};

  function errorText(current: Failure): string {
    if (current.reason === "validation") {
      // A rejected field the visitor cannot see (a stale form) is not something they can fix.
      if (invalid.length === 0) return copy.errors.unavailable;
      const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
      return copy.validation.replace("{fields}", list.format(invalid.map((f) => labels[f])));
    }
    if (current.reason === "rate_limited") return copy.errors.rateLimited;
    if (current.reason === "unavailable") return copy.errors.unavailable;
    return copy.errors.network;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isPending) return;
    const input: LeadFormInput = {
      formId,
      name,
      phone,
      ...(showEmail ? { email } : {}),
      ...(showMessage ? { message } : {}),
      honeypot,
      elapsedMs: shownAt.current === null ? 0 : Math.max(0, Date.now() - shownAt.current),
      submissionKey: submissionKey === "" ? crypto.randomUUID() : submissionKey,
    };
    setFailure(null);
    startTransition(async () => {
      const result = await submitLead(input);
      if (result.ok) {
        setDone(true);
        setSubmissionKey(crypto.randomUUID());
        return;
      }
      setFailure(
        result.reason === "validation"
          ? { reason: "validation", fields: result.fields }
          : { reason: result.reason },
      );
    });
  }

  if (done) {
    return (
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        dir="auto"
        className="text-foreground break-words text-base"
      >
        {successMessage}
      </p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={labelledBy}
      className="flex flex-col gap-4 text-start"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-name`}>{copy.name}</Label>
        <Input
          id={`${uid}-name`}
          name="name"
          required
          maxLength={MAX_NAME}
          dir="auto"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          {...fieldError("name")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-phone`}>{copy.phone}</Label>
        <Input
          id={`${uid}-phone`}
          name="phone"
          type="tel"
          required
          maxLength={MAX_PHONE}
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          {...fieldError("phone")}
        />
      </div>

      {showEmail ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-email`}>{copy.email}</Label>
          <Input
            id={`${uid}-email`}
            name="email"
            type="email"
            maxLength={MAX_EMAIL}
            dir="ltr"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            {...fieldError("email")}
          />
        </div>
      ) : null}

      {showMessage ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-message`}>{copy.message}</Label>
          <Textarea
            id={`${uid}-message`}
            name="message"
            rows={4}
            maxLength={MAX_MESSAGE}
            dir="auto"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            {...fieldError("message")}
          />
        </div>
      ) : null}

      {/* The trap: invisible and unreachable for a person, an easy target for a bot. */}
      <div aria-hidden="true" className="sr-only">
        <Label htmlFor={`${uid}-website`}>{copy.honeypotLabel}</Label>
        <Input
          id={`${uid}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      {failure === null ? null : (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {errorText(failure)}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className={`${BUTTON_CLASS.primary} self-start disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <bdi dir="auto">{submitLabel}</bdi>
      </button>
    </form>
  );
}
