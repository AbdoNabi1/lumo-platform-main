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
  CUSTOM_SMTP_PORTS,
  EMAIL_PROVIDER_CHOICES,
  isPlausibleEmail,
  isSmtpPresetId,
  isSmtpSecurity,
  normalizeEmail,
  SMTP_PRESET_CHOICES,
  type EmailConnectionActionResult,
  type EmailConnectionDto,
  type EmailConnectionKind,
  type EmailConnectionSnapshot,
  type EmailConnectionState,
  type EmailSaveSmtp,
  type SmtpPresetId,
  type SmtpSecurity,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { BdiText, fillText } from "./bdi-text";
import { EmailDisconnectDialog } from "./email-disconnect-dialog";

const HOW_TO = [
  { text: "howTo1", link: "howToLink1", href: "https://resend.com" },
  { text: "howTo2", link: "howToLink2", href: "https://resend.com/domains" },
  { text: "howTo3", link: "howToLink3", href: "https://resend.com/api-keys" },
] as const;

const GMAIL_HOW_TO = [
  {
    text: "gmailHowTo1",
    link: "gmailLink1",
    href: "https://myaccount.google.com/signinoptions/twosv",
  },
  { text: "gmailHowTo2", link: "gmailLink2", href: "https://myaccount.google.com/apppasswords" },
  { text: "gmailHowTo3", link: null, href: null },
  { text: "gmailHowTo4", link: null, href: null },
] as const;

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 max-w-md rounded-xl border px-3.5 text-sm transition-colors ease-out aria-invalid:border-destructive";

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

function HowToList({
  title,
  id,
  steps,
  t,
}: {
  readonly title: string;
  readonly id: string;
  readonly steps: readonly {
    readonly text: string;
    readonly link: string | null;
    readonly href: string | null;
  }[];
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings.email as unknown as Record<string, string>;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-sm font-medium">
        {title}
      </h3>
      <ol className="text-muted-foreground flex list-decimal flex-col gap-1 ps-5 text-sm">
        {steps.map((step) => (
          <li key={step.text}>
            {copy[step.text]}
            {step.link !== null && step.href !== null && (
              <>
                {" "}
                <a
                  href={step.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground font-medium underline"
                >
                  {copy[step.link]}
                </a>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function HowTo({ t }: { readonly t: Dictionary }) {
  return (
    <HowToList
      title={t.notificationSettings.email.howToTitle}
      id="email-how-to"
      steps={HOW_TO}
      t={t}
    />
  );
}

/** What to do at the mailbox provider: Gmail gets the app-password steps, the others a short note. */
function MailboxHowTo({ preset, t }: { readonly preset: SmtpPresetId; readonly t: Dictionary }) {
  const copy = t.notificationSettings.email;
  if (preset === "gmail") {
    return (
      <HowToList title={copy.gmailHowToTitle} id="email-gmail-how-to" steps={GMAIL_HOW_TO} t={t} />
    );
  }
  const note =
    preset === "outlook" ? copy.outlookNote : preset === "zoho" ? copy.zohoNote : copy.customNote;
  return (
    <p role="note" data-testid="email-mailbox-note" className="text-muted-foreground text-sm">
      {note}
    </p>
  );
}

/**
 * The providers come from the model: one that has a `kind` can be picked, the rest say "Coming
 * soon". A mailbox needs the server's SMTP switch: without it the option is disabled and says so.
 */
function ProviderChoice({
  selected,
  onSelect,
  smtpAvailable,
  t,
}: {
  readonly selected: EmailConnectionKind;
  readonly onSelect: (kind: EmailConnectionKind) => void;
  readonly smtpAvailable: boolean;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings.email;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{copy.providerLabel}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {EMAIL_PROVIDER_CHOICES.map((choice) => {
          if (choice.kind === null) {
            return (
              <label
                key={choice.id}
                className="text-muted-foreground flex items-center gap-2 text-sm"
              >
                <input type="radio" name="emailProvider" value={choice.id} disabled />
                {choice.label}
                <Badge variant="outline">{copy.comingSoon}</Badge>
              </label>
            );
          }
          const kind = choice.kind;
          const blocked = choice.needsSmtp && !smtpAvailable;
          return (
            <label
              key={choice.id}
              className={
                blocked
                  ? "text-muted-foreground flex items-center gap-2 text-sm"
                  : "flex items-center gap-2 text-sm"
              }
            >
              <input
                type="radio"
                name="emailProvider"
                value={choice.id}
                checked={kind === selected}
                disabled={blocked && kind !== selected}
                onChange={() => onSelect(kind)}
                className="accent-primary"
              />
              {choice.label}
              {blocked && <Badge variant="outline">{copy.needsUpgrade}</Badge>}
            </label>
          );
        })}
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
  const [provider, setProvider] = useState<EmailConnectionKind>(connection?.kind ?? "resend");
  const [from, setFrom] = useState(connection?.fromEmail ?? "");
  const [key, setKey] = useState("");
  const [preset, setPreset] = useState<SmtpPresetId>(connection?.smtp?.preset ?? "gmail");
  const [host, setHost] = useState(
    connection?.smtp?.preset === "custom" ? connection.smtp.host : "",
  );
  const [port, setPort] = useState(
    connection?.smtp?.preset === "custom" ? String(connection.smtp.port) : "465",
  );
  const [security, setSecurity] = useState<SmtpSecurity>(
    connection?.smtp?.preset === "custom" ? connection.smtp.security : "tls",
  );
  const [username, setUsername] = useState(connection?.smtp?.username ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState(NO_ERRORS);
  const [busy, setBusy] = useState<"save" | "test" | "switch" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [seen, setSeen] = useState(email);
  const fromInput = useRef<HTMLInputElement>(null);
  const refocusFrom = useRef(false);

  if (email !== seen) {
    setSeen(email);
    if (email.connection?.version !== seen.connection?.version) {
      const next = email.connection;
      setProvider(next?.kind ?? provider);
      setFrom(next?.fromEmail ?? "");
      setKey("");
      setPassword("");
      setPreset(next?.smtp?.preset ?? "gmail");
      setHost(next?.smtp?.preset === "custom" ? next.smtp.host : "");
      setPort(next?.smtp?.preset === "custom" ? String(next.smtp.port) : "465");
      setSecurity(next?.smtp?.preset === "custom" ? next.smtp.security : "tls");
      setUsername(next?.smtp?.username ?? "");
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

  /** A mailbox field's error: the page's own check (`host`) or the server's (`smtp.host`). */
  const fieldError = (name: string): string | undefined =>
    errors[name] ?? errors[`smtp.${name}`] ?? (name === "preset" ? errors["smtp"] : undefined);
  const mailbox = provider === "smtp";
  const smtpBlocked = mailbox && !email.smtpAvailable;
  const presetChoice = SMTP_PRESET_CHOICES.find((choice) => choice.id === preset);
  const isCustom = preset === "custom";
  // A saved mailbox keeps its password only for the same server and user: the server enforces it.
  const keepsPassword = connection?.kind === "smtp";

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (smtpBlocked) return;
    const address = from.trim();
    const local: Record<string, string> = {};
    if (!isPlausibleEmail(address)) local["fromEmail"] = copy.fromInvalid;

    if (!mailbox) {
      const apiKey = key.trim();
      // A stored key is only kept for the same kind of account: switching provider needs a new one.
      const keepsKey = connection?.kind === "resend";
      if (!keepsKey && apiKey === "") local["apiKey"] = copy.keyRequired;
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
      return;
    }

    const user = username.trim();
    const secret = password.trim();
    if (user === "") local["username"] = copy.usernameRequired;
    if (!keepsPassword && secret === "") local["password"] = copy.passwordRequired;
    if (isCustom) {
      if (host.trim() === "") local["host"] = copy.hostRequired;
      if (!CUSTOM_SMTP_PORTS.includes(Number(port))) local["port"] = copy.portInvalid;
    } else if (
      presetChoice?.fromIsUsername === true &&
      user !== "" &&
      isPlausibleEmail(address) &&
      user.toLowerCase() !== address.toLowerCase()
    ) {
      local["fromEmail"] = copy.fromMustMatch;
    }
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setNotice(null);
      return;
    }
    const smtp: EmailSaveSmtp = isCustom
      ? { preset, username: user, host: host.trim(), port: Number(port), security }
      : { preset, username: user };
    await call(
      "save",
      () =>
        saveEmailConnectionAction({
          kind: "smtp",
          fromEmail: normalizeEmail(address),
          smtp,
          password: secret === "" ? null : secret,
          expectedVersion: connection?.version ?? null,
        }),
      (snapshot) => {
        setPassword("");
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

  const freeMail =
    !mailbox && /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud)\./i.test(from.trim());
  const pending = busy !== null;
  const locked = pending || smtpBlocked;

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <ProviderChoice
        selected={provider}
        onSelect={(kind) => {
          setProvider(kind);
          setErrors(NO_ERRORS);
          setNotice(null);
        }}
        smtpAvailable={email.smtpAvailable}
        t={t}
      />
      {smtpBlocked && (
        <div
          role="note"
          data-testid="email-needs-upgrade"
          className="border-border rounded-lg border p-3"
        >
          <p className="text-sm font-medium">{copy.needsUpgrade}</p>
          <p className="text-muted-foreground text-sm">{copy.needsUpgradeBody}</p>
        </div>
      )}
      {mailbox ? <MailboxHowTo preset={preset} t={t} /> : <HowTo t={t} />}
      <SendingLimits t={t} />

      {mailbox && (
        <Field label={copy.presetLabel} name="preset" error={fieldError("preset")}>
          {(control) => (
            <select
              {...control}
              className={SELECT_CLASS}
              value={preset}
              disabled={locked}
              onChange={(event) => {
                const next = event.target.value;
                if (isSmtpPresetId(next)) setPreset(next);
              }}
            >
              {SMTP_PRESET_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label ?? copy.presetCustom}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {mailbox && isCustom && (
        <>
          <Field label={copy.hostLabel} name="host" error={fieldError("host")} hint={copy.hostHint}>
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                className="max-w-md text-start"
                value={host}
                disabled={locked}
                onChange={(event) => setHost(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-4">
            <Field label={copy.portLabel} name="port" error={fieldError("port")}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-28 text-start"
                  value={port}
                  disabled={locked}
                  onChange={(event) => setPort(event.target.value)}
                />
              )}
            </Field>
            <Field label={copy.securityLabel} name="security" error={fieldError("security")}>
              {(control) => (
                <select
                  {...control}
                  className={SELECT_CLASS}
                  value={security}
                  disabled={locked}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (isSmtpSecurity(next)) setSecurity(next);
                  }}
                >
                  <option value="tls">{copy.securityTls}</option>
                  <option value="starttls">{copy.securityStartTls}</option>
                </select>
              )}
            </Field>
          </div>
        </>
      )}

      <Field
        label={copy.fromLabel}
        name="fromEmail"
        error={errors["fromEmail"]}
        hint={mailbox ? undefined : copy.fromHint}
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
            disabled={locked}
            onChange={(event) => setFrom(event.target.value)}
          />
        )}
      </Field>
      {freeMail && <p className="text-muted-foreground text-sm">{copy.freeMail}</p>}

      {mailbox ? (
        <>
          <Field
            label={copy.usernameLabel}
            name="username"
            error={fieldError("username")}
            hint={copy.usernameHint}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                className="max-w-md text-start"
                value={username}
                disabled={locked}
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={copy.passwordLabel}
            name="password"
            error={errors["password"]}
            hint={keepsPassword ? copy.passwordSaved : copy.passwordHint}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                spellCheck={false}
                className="max-w-md text-start"
                value={password}
                disabled={locked}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
        </>
      ) : (
        <Field
          label={copy.keyLabel}
          name="apiKey"
          error={errors["apiKey"]}
          hint={
            connection === null || connection.kind !== "resend"
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
              disabled={locked}
              onChange={(event) => setKey(event.target.value)}
            />
          )}
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy === "save"} disabled={locked}>
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
            disabled={pending || (connection.kind === "smtp" && !email.smtpAvailable)}
            onCheckedChange={switchTo}
          />
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              loading={busy === "test"}
              disabled={pending || (connection.kind === "smtp" && !email.smtpAvailable)}
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

        {connection !== null && connection.lastError !== null && (
          <LastError
            message={
              connection.lastErrorCode === null
                ? connection.lastError
                : copy.smtpErrors[connection.lastErrorCode]
            }
            template={copy.lastError}
          />
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
