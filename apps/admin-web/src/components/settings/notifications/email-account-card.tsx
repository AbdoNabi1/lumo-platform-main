"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import {
  saveEmailConnectionAction,
  setEmailConnectionEnabledAction,
  testEmailConnectionAction,
} from "@/app/settings/notifications/actions";
import { Field } from "@/components/products/editor/field";
import { Switch } from "@/components/products/editor/controls";
import {
  connectionStateOf,
  EMAIL_PROVIDER_CHOICES,
  isPlausibleEmail,
  normalizeEmail,
  type EmailConnectionActionResult,
  type EmailConnectionDto,
  type EmailConnectionSnapshot,
  type EmailConnectionState,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { BdiText, fillText } from "./bdi-text";
import { EmailDisconnectDialog } from "./email-disconnect-dialog";

const HOW_TO = [
  { text: "howTo1", link: "howToLink1", href: "https://resend.com" },
  { text: "howTo2", link: "howToLink2", href: "https://resend.com/domains" },
  { text: "howTo3", link: "howToLink3", href: "https://resend.com/api-keys" },
] as const;

const NO_ERRORS: Readonly<Record<string, string>> = {};

interface Notice {
  readonly tone: "ok" | "error";
  readonly text: string;
}

function chipOf(
  state: EmailConnectionState,
  copy: Dictionary["notificationSettings"]["email"],
): { readonly label: string; readonly variant: "success" | "destructive" | "neutral" | "warning" } {
  switch (state) {
    case "connected":
      return { label: copy.statusConnected, variant: "success" };
    case "failed":
      return { label: copy.statusFailed, variant: "destructive" };
    case "disabled":
      return { label: copy.statusOff, variant: "warning" };
    case "none":
      return { label: copy.statusNotConnected, variant: "neutral" };
  }
}

/** Why a call was refused, or null when it went through. A refused test mail is NOT a refusal here. */
function refusalOf(
  result: EmailConnectionActionResult,
  copy: Dictionary["notificationSettings"]["email"],
): { readonly text: string; readonly fieldErrors: Readonly<Record<string, string>> } | null {
  switch (result.status) {
    case "success":
      return null;
    case "unavailable":
      return { text: copy.unavailable, fieldErrors: NO_ERRORS };
    case "rate_limited":
      return { text: copy.rateLimited, fieldErrors: NO_ERRORS };
    case "conflict":
      return { text: result.message, fieldErrors: NO_ERRORS };
    case "error":
      return { text: result.message, fieldErrors: result.fieldErrors };
  }
}

function StatusChip({
  email,
  t,
}: {
  readonly email: EmailConnectionSnapshot;
  readonly t: Dictionary;
}) {
  const chip = chipOf(connectionStateOf(email), t.notificationSettings.email);
  return (
    <Badge variant={chip.variant} data-testid="email-status">
      {chip.label}
    </Badge>
  );
}

/** The provider's refusal as the server sent it (already sanitized), isolated so it cannot reorder the sentence. */
function LastError({ message, template }: { readonly message: string; readonly template: string }) {
  const [before = "", after = ""] = template.split("{error}");
  return (
    <p role="note" data-testid="email-last-error" className="text-destructive text-sm">
      {before}
      <bdi dir="auto">{message}</bdi>
      {after}
    </p>
  );
}

function HowTo({ t }: { readonly t: Dictionary }) {
  const copy = t.notificationSettings.email;
  return (
    <section aria-labelledby="email-how-to" className="flex flex-col gap-2">
      <h3 id="email-how-to" className="text-sm font-medium">
        {copy.howToTitle}
      </h3>
      <ol className="text-muted-foreground flex list-decimal flex-col gap-1 ps-5 text-sm">
        {HOW_TO.map((step) => (
          <li key={step.text}>
            {copy[step.text]}{" "}
            <a
              href={step.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground font-medium underline"
            >
              {copy[step.link]}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The providers come from the model: one that has a `kind` can be picked, the rest say "Coming soon". */
function ProviderChoice({ t }: { readonly t: Dictionary }) {
  const copy = t.notificationSettings.email;
  const selected = EMAIL_PROVIDER_CHOICES.find((choice) => choice.kind !== null)?.id;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{copy.providerLabel}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {EMAIL_PROVIDER_CHOICES.map((choice) =>
          choice.kind !== null ? (
            <label key={choice.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="emailProvider"
                value={choice.id}
                checked={choice.id === selected}
                readOnly
                className="accent-primary"
              />
              {choice.label}
            </label>
          ) : (
            <label
              key={choice.id}
              className="text-muted-foreground flex items-center gap-2 text-sm"
            >
              <input type="radio" name="emailProvider" value={choice.id} disabled />
              {choice.label}
              <Badge variant="outline">{copy.comingSoon}</Badge>
            </label>
          ),
        )}
      </div>
    </fieldset>
  );
}

/** What each provider lets a store send, so nobody is surprised by a cap. Muted: it is a note, not a setting. */
function SendingLimits({ t }: { readonly t: Dictionary }) {
  const copy = t.notificationSettings.email;
  return (
    <section
      aria-labelledby="email-limits"
      data-testid="email-limits"
      className="text-muted-foreground flex flex-col gap-1 text-sm"
    >
      <h3 id="email-limits" className="text-sm font-medium">
        {copy.limitsTitle}
      </h3>
      <ul className="flex list-disc flex-col gap-1 ps-5">
        <li>{copy.limitsResend}</li>
        <li>{copy.limitsGmail}</li>
      </ul>
      <p>{copy.limitsClosing}</p>
    </section>
  );
}

/**
 * The connected account's body: the form, the test and the switch. It is mounted only when the page
 * could read the account, so its hooks never run conditionally. A newer version from the server
 * (someone else saved; a reload) replaces what is typed; the key is never prefilled.
 */
function EmailAccountBody({
  email,
  onChange,
  t,
}: {
  readonly email: EmailConnectionSnapshot;
  readonly onChange: (snapshot: EmailConnectionSnapshot) => void;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings.email;
  const connection: EmailConnectionDto | null = email.connection;
  const [from, setFrom] = useState(connection?.fromEmail ?? "");
  const [key, setKey] = useState("");
  const [errors, setErrors] = useState(NO_ERRORS);
  const [busy, setBusy] = useState<"save" | "test" | "switch" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [seen, setSeen] = useState(email);
  const fromInput = useRef<HTMLInputElement>(null);
  const refocusFrom = useRef(false);

  if (email !== seen) {
    setSeen(email);
    if (email.connection?.version !== seen.connection?.version) {
      setFrom(email.connection?.fromEmail ?? "");
      setKey("");
    }
  }

  // After "Disconnect" the dialog's trigger is gone: keyboard focus moves to the form instead.
  useEffect(() => {
    if (refocusFrom.current && connection === null) {
      refocusFrom.current = false;
      fromInput.current?.focus();
    }
  }, [connection]);

  const settle = (
    result: EmailConnectionActionResult,
    onSuccess: (snapshot: EmailConnectionSnapshot) => Notice | null,
  ) => {
    const refused = refusalOf(result, copy);
    if (refused !== null) {
      setErrors(refused.fieldErrors);
      setNotice({ tone: "error", text: refused.text });
      return;
    }
    if (result.status === "success") {
      onChange(result.snapshot);
      setNotice(onSuccess(result.snapshot));
    }
  };

  const call = async (
    kind: "save" | "test" | "switch",
    run: () => Promise<EmailConnectionActionResult>,
    onSuccess: (snapshot: EmailConnectionSnapshot) => Notice | null,
  ) => {
    setBusy(kind);
    setNotice(null);
    setErrors(NO_ERRORS);
    try {
      settle(await run(), onSuccess);
    } catch {
      setNotice({ tone: "error", text: t.formErrors.unexpected });
    } finally {
      setBusy(null);
    }
  };

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const address = from.trim();
    const apiKey = key.trim();
    const local: Record<string, string> = {};
    if (!isPlausibleEmail(address)) local["fromEmail"] = copy.fromInvalid;
    if (connection === null && apiKey === "") local["apiKey"] = copy.keyRequired;
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setNotice(null);
      return;
    }
    await call(
      "save",
      () =>
        saveEmailConnectionAction({
          kind: "resend",
          fromEmail: normalizeEmail(address),
          apiKey: apiKey === "" ? null : apiKey,
          expectedVersion: connection?.version ?? null,
        }),
      (snapshot) => {
        setKey("");
        return snapshot.connection?.status === "connected"
          ? { tone: "ok", text: copy.savedConnected }
          : { tone: "error", text: copy.savedFailed };
      },
    );
  };

  const sendTest = () =>
    call(
      "test",
      () => testEmailConnectionAction(),
      (snapshot) =>
        snapshot.connection?.status === "connected"
          ? { tone: "ok", text: copy.testSent }
          : { tone: "error", text: copy.testFailed },
    );

  const switchTo = (enabled: boolean) => {
    if (connection === null) return;
    void call(
      "switch",
      () => setEmailConnectionEnabledAction({ enabled, expectedVersion: connection.version }),
      () => null,
    );
  };

  const freeMail = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud)\./i.test(from.trim());
  const pending = busy !== null;

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <HowTo t={t} />
      <ProviderChoice t={t} />
      <SendingLimits t={t} />

      <Field
        label={copy.fromLabel}
        name="fromEmail"
        error={errors["fromEmail"]}
        hint={copy.fromHint}
      >
        {(control) => (
          <Input
            {...control}
            ref={fromInput}
            type="email"
            dir="ltr"
            autoComplete="off"
            className="max-w-md text-start"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        )}
      </Field>
      {freeMail && <p className="text-muted-foreground text-sm">{copy.freeMail}</p>}

      <Field
        label={copy.keyLabel}
        name="apiKey"
        error={errors["apiKey"]}
        hint={
          connection === null
            ? copy.keyHint
            : fillText(copy.keyStored, { last4: connection.secretLast4 })
        }
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            spellCheck={false}
            className="max-w-md text-start"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy === "save"} disabled={pending}>
          {busy === "save" ? copy.saving : copy.save}
        </Button>
        <span className="text-muted-foreground text-sm">{copy.saveHint}</span>
      </div>

      {notice !== null && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "text-destructive text-sm" : "text-sm"}
        >
          {notice.text}
        </p>
      )}

      {connection !== null && (
        <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
          <Switch
            label={copy.enabledLabel}
            checked={connection.enabled}
            disabled={pending}
            onCheckedChange={switchTo}
          />
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              loading={busy === "test"}
              disabled={pending}
              onClick={() => void sendTest()}
            >
              {busy === "test" ? copy.sendingTest : copy.sendTest}
            </Button>
            <EmailDisconnectDialog
              disabled={pending}
              onDisconnected={(snapshot) => {
                refocusFrom.current = true;
                setNotice({ tone: "ok", text: copy.disconnected });
                onChange(snapshot);
              }}
              onRefused={(message) => setNotice({ tone: "error", text: message })}
              t={t}
            />
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Email account (D45-D49): the store's OWN email account, the only way customer emails are sent.
 * The key is write-only. Save connects it and sends a test email to the signed-in member, and the
 * answer is shown as it came (a refused test is "Failed", with the provider's sanitized message).
 * `email` is null when the page could not read the account: the card then says so rather than
 * guessing "not connected".
 */
export function EmailAccountCard({
  email,
  onChange,
  t,
}: {
  readonly email: EmailConnectionSnapshot | null;
  readonly onChange: (snapshot: EmailConnectionSnapshot) => void;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings.email;
  const connection = email?.connection ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{copy.title}</CardTitle>
          {email !== null && <StatusChip email={email} t={t} />}
        </div>
        <p className="text-muted-foreground text-sm">{copy.hint}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {email === null && (
          <p role="note" className="text-muted-foreground text-sm">
            {copy.loadError}
          </p>
        )}

        {connection !== null && (
          <p className="text-sm">
            <BdiText template={copy.sendingFrom} values={{ email: connection.fromEmail }} />
          </p>
        )}

        {connection?.lastError != null && (
          <LastError message={connection.lastError} template={copy.lastError} />
        )}

        {email !== null && !email.credentialsConfigured && (
          <div role="note" className="border-border rounded-lg border p-3">
            <p className="text-sm font-medium">{copy.notAvailable}</p>
            <p className="text-muted-foreground text-sm">{copy.notAvailableBody}</p>
          </div>
        )}

        {email !== null && email.credentialsConfigured && (
          <EmailAccountBody email={email} onChange={onChange} t={t} />
        )}
      </CardContent>
    </Card>
  );
}
