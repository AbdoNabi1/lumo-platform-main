"use client";

import { useRef, useState, useTransition } from "react";
import { Button, Input, Label, NativeSelect } from "@platform/ui";
import { testSendAction, type TestSendActionState } from "@/app/settings/whatsapp/actions";
import type { TestSendInput, WhatsAppTemplateDto } from "@/lib/api/outreach";
import { newClientKey, PHONE_PATTERN } from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";
import { BrandText } from "./brand-text";

/**
 * The test-send form. Idempotency (R2-B14):
 *  - ONE key is made when the form mounts and sent with every submission;
 *  - a retry of the SAME request (a transport error) reuses it;
 *  - after `accepted` the next submission gets a new key;
 *  - a different request (for example the attestation ticked after `suppressed`) is a new submission with a new key,
 *    because the key is bound to the request it was first used with;
 *  - after `failed` or `unknown` the key is KEPT and sending again to the same recipient + template is disabled until
 *    the merchant changes either one. There is deliberately no "Try again".
 */

interface KeyHolder {
  key: string;
  /** The request (serialised) the current key was first sent with; `null` while unused. */
  usedFor: string | null;
}

function templateKey(template: WhatsAppTemplateDto): string {
  return `${template.name}::${template.language}`;
}
function pairOf(to: string, template: string): string {
  return `${to.replace(/[\s()-]/g, "")}|${template}`;
}

/** Only an APPROVED template whose shape the sender can fill is offered. */
export function sendableTemplates(
  templates: readonly WhatsAppTemplateDto[],
): readonly WhatsAppTemplateDto[] {
  return templates.filter((template) => template.status === "APPROVED" && template.supported);
}

/** The URL buttons that need a value, keyed by the button's index. */
function urlButtons(template: WhatsAppTemplateDto): readonly { index: number }[] {
  return template.sendShape.buttons.filter((b) => b.type === "URL" && b.urlHasVariable);
}

export function TestSendForm({
  templates,
  t,
}: {
  readonly templates: readonly WhatsAppTemplateDto[];
  readonly t: Dictionary;
}) {
  const copy = t.whatsappSettings.test;
  const options = sendableTemplates(templates);
  const [holder] = useState<KeyHolder>(() => ({ key: newClientKey(), usedFor: null }));
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState("");
  const [body, setBody] = useState<readonly string[]>([]);
  const [header, setHeader] = useState("");
  const [suffixes, setSuffixes] = useState<Readonly<Record<string, string>>>({});
  const [attest, setAttest] = useState(false);
  const [result, setResult] = useState<TestSendActionState | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const [suppressedPair, setSuppressedPair] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [unresolved, setUnresolved] = useState<{ payload: TestSendInput; key: string } | null>(
    null,
  );
  const inFlight = useRef(false);

  const template = options.find((candidate) => templateKey(candidate) === selected) ?? null;
  const shape = template?.sendShape ?? null;
  const urls = template === null ? [] : urlButtons(template);
  const toTrimmed = to.trim();
  const phoneValid = PHONE_PATTERN.test(toTrimmed);
  const pair = pairOf(toTrimmed, selected);
  const complete =
    template !== null &&
    shape !== null &&
    body.length === shape.bodyVariableCount &&
    body.every((value) => value.trim().length > 0) &&
    (!shape.headerHasVariable || header.trim().length > 0) &&
    urls.every(({ index }) => (suffixes[String(index)] ?? "").trim().length > 0);
  const isBlocked = blocked.has(pair);
  const needsAttestation = suppressedPair === pair && !attest;
  const canSubmit = phoneValid && complete && !isBlocked && !needsAttestation && !pending;

  function chooseTemplate(next: string) {
    setSelected(next);
    const chosen = options.find((candidate) => templateKey(candidate) === next) ?? null;
    setBody(Array.from({ length: chosen?.sendShape.bodyVariableCount ?? 0 }, () => ""));
    setHeader("");
    setSuffixes({});
    setResult(null);
  }

  function request(): TestSendInput | null {
    if (template === null || shape === null) return null;
    const values: {
      body: readonly string[];
      header?: string;
      urlSuffixes?: Record<string, string>;
    } = { body: body.map((value) => value.trim()) };
    if (shape.headerHasVariable) values.header = header.trim();
    if (urls.length > 0) {
      values.urlSuffixes = Object.fromEntries(
        urls.map(({ index }) => [String(index), (suffixes[String(index)] ?? "").trim()]),
      );
    }
    return {
      to: toTrimmed,
      templateName: template.name,
      language: template.language,
      values,
      ...(attest ? { attestConsent: true } : {}),
    };
  }

  function submit() {
    const input = request();
    if (input === null || !canSubmit || inFlight.current) return;
    const signature = JSON.stringify(input);
    if (unresolved === null && holder.usedFor !== null && holder.usedFor !== signature)
      holder.key = newClientKey();
    const submission = unresolved ?? { payload: input, key: holder.key };
    holder.usedFor = JSON.stringify(submission.payload);
    setUnresolved(submission);
    inFlight.current = true;
    const submittedPair = pair;
    startTransition(async () => {
      let outcome: TestSendActionState;
      try {
        outcome = await testSendAction({ ...submission.payload, idempotencyKey: submission.key });
      } catch {
        outcome = { status: "error", message: t.whatsappSettings.errors.generic };
      } finally {
        inFlight.current = false;
      }
      setResult(outcome);
      if (outcome.status !== "result") return;
      setUnresolved(null);
      if (outcome.outcome === "accepted") {
        // Definitive: the next submission is a new one.
        holder.key = newClientKey();
        holder.usedFor = null;
        setTo("");
        setBody(Array.from({ length: shape?.bodyVariableCount ?? 0 }, () => ""));
        setHeader("");
        setSuffixes({});
        setAttest(false);
        setSuppressedPair(null);
      } else if (outcome.outcome === "suppressed") {
        setSuppressedPair(submittedPair);
      } else {
        // failed / unknown: keep the key and do not send this recipient + template again from here.
        setBlocked((previous) => new Set(previous).add(submittedPair));
      }
    });
  }

  if (options.length === 0) {
    return (
      <p role="note" className="text-muted-foreground text-sm">
        <BrandText text={copy.noTemplates} />
      </p>
    );
  }

  const failed = result?.status === "result" && result.outcome === "failed";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={unresolved !== null || pending} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whatsapp-test-to">{copy.to}</Label>
          <Input
            id="whatsapp-test-to"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            className="text-start"
            value={to}
            aria-invalid={toTrimmed.length > 0 && !phoneValid}
            aria-describedby="whatsapp-test-to-hint"
            onChange={(event) => {
              setTo(event.target.value);
              setResult(null);
            }}
          />
          <p
            id="whatsapp-test-to-hint"
            className={
              toTrimmed.length > 0 && !phoneValid
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {toTrimmed.length > 0 && !phoneValid ? copy.toInvalid : copy.toHint}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whatsapp-test-template">{copy.template}</Label>
          <NativeSelect
            id="whatsapp-test-template"
            value={selected}
            onChange={(event) => chooseTemplate(event.target.value)}
          >
            <option value="">{copy.templatePlaceholder}</option>
            {options.map((candidate) => (
              <option key={templateKey(candidate)} value={templateKey(candidate)}>
                {candidate.name} · {candidate.language}
              </option>
            ))}
          </NativeSelect>
        </div>

        {shape !== null && shape.headerHasVariable && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whatsapp-test-header">{copy.headerValue}</Label>
            <Input
              id="whatsapp-test-header"
              dir="auto"
              className="text-start"
              value={header}
              onChange={(event) => setHeader(event.target.value)}
            />
          </div>
        )}
        {body.map((value, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Label htmlFor={`whatsapp-test-body-${index}`}>
              {copy.bodyValue.replace("{index}", String(index + 1))}
            </Label>
            <Input
              id={`whatsapp-test-body-${index}`}
              dir="auto"
              className="text-start"
              value={value}
              onChange={(event) =>
                setBody((previous) =>
                  previous.map((v, i) => (i === index ? event.target.value : v)),
                )
              }
            />
          </div>
        ))}
        {urls.map(({ index }) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Label htmlFor={`whatsapp-test-url-${index}`}>
              {copy.urlSuffix.replace("{index}", String(index + 1))}
            </Label>
            <Input
              id={`whatsapp-test-url-${index}`}
              dir="ltr"
              className="text-start"
              value={suffixes[String(index)] ?? ""}
              onChange={(event) =>
                setSuffixes((previous) => ({ ...previous, [String(index)]: event.target.value }))
              }
            />
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <input
              id="whatsapp-test-attest"
              type="checkbox"
              className="accent-primary mt-1 size-4"
              checked={attest}
              aria-describedby={suppressedPair === pair ? "whatsapp-test-attest-hint" : undefined}
              onChange={(event) => setAttest(event.target.checked)}
            />
            <Label htmlFor="whatsapp-test-attest" className="text-sm font-normal leading-snug">
              <BrandText text={copy.attest} />
            </Label>
          </div>
          {suppressedPair === pair && (
            <p id="whatsapp-test-attest-hint" className="text-muted-foreground ps-6 text-sm">
              {copy.attestHint}
            </p>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {pending ? copy.submitting : copy.submit}
        </Button>
        {template !== null && phoneValid && !complete && (
          <span className="text-muted-foreground text-sm">{copy.valueRequired}</span>
        )}
      </div>

      {isBlocked && (
        <p className="text-muted-foreground text-sm">
          <BrandText text={copy.blockedHint} />
        </p>
      )}
      {result !== null && (
        <p
          role={result.status === "error" || failed ? "alert" : "status"}
          className={
            result.status === "error" || failed
              ? "text-destructive text-sm"
              : "text-foreground text-sm"
          }
        >
          <BrandText text={result.message} />
        </p>
      )}
    </form>
  );
}
