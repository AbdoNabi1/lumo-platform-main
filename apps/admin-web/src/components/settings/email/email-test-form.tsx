"use client";

import { useRef, useState, useTransition } from "react";
import { Button, Input, Label } from "@platform/ui";
import { sendTestEmailAction, type EmailTestState } from "@/app/settings/email/actions";
import { isPlausibleEmail, normalizeEmail } from "@/lib/outreach/email";
import { newClientKey } from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";

/**
 * The test-email form. It follows the WhatsApp test-send key lifecycle exactly (R2-B14):
 *  - ONE key is made when the form mounts and sent with a submission;
 *  - a transport failure (the answer was lost) leaves the submission UNRESOLVED: the form keeps the exact
 *    `{payload, key}`, locks the address, and "Send test email" re-sends that same request, so it can never send twice;
 *  - a definitive answer releases the lock and the next submission gets a new key (after `accepted`, `suppressed` or a
 *    refusal that dispatched nothing);
 *  - after `failed` or `unknown` the key is KEPT and sending again to the same address is blocked until the merchant
 *    changes it. There is deliberately no "Try again";
 *  - a different address is a different request, so it never reuses the key of the first one.
 *
 * The form stays mounted for the page's lifetime, so nothing here can be dropped by collapsing a panel.
 */

interface Submission {
  readonly to: string;
  readonly key: string;
}

export function EmailTestForm({
  defaultTo,
  t,
}: {
  readonly defaultTo: string;
  readonly t: Dictionary;
}) {
  const copy = t.emailSettings.test;
  const [holder] = useState(() => ({ key: newClientKey(), usedFor: null as string | null }));
  const [to, setTo] = useState(defaultTo);
  const [result, setResult] = useState<EmailTestState | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const [unresolved, setUnresolved] = useState<Submission | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const trimmed = to.trim();
  const valid = isPlausibleEmail(trimmed);
  const isBlocked = blocked.has(normalizeEmail(trimmed));
  const canSubmit = unresolved !== null ? !pending : valid && !isBlocked && !pending;

  function submit() {
    if (inFlight.current || !canSubmit) return;
    let submission = unresolved;
    if (submission === null) {
      // A different request than the one the current key was first used with needs its own key.
      if (holder.usedFor !== null && holder.usedFor !== trimmed) holder.key = newClientKey();
      submission = { to: trimmed, key: holder.key };
    }
    holder.usedFor = submission.to;
    setUnresolved(submission);
    inFlight.current = true;
    const sent = submission;
    startTransition(async () => {
      let outcome: EmailTestState;
      try {
        outcome = await sendTestEmailAction({ to: sent.to, idempotencyKey: sent.key });
      } catch {
        outcome = { status: "error", message: t.emailSettings.errors.generic };
      } finally {
        inFlight.current = false;
      }
      setResult(outcome);
      if (outcome.status === "error") return; // unresolved: same payload, same key, locked
      setUnresolved(null);
      if (outcome.status === "refused") {
        // Nothing was dispatched: the next submission is a new one.
        holder.key = newClientKey();
        holder.usedFor = null;
      } else if (outcome.outcome === "accepted" || outcome.outcome === "suppressed") {
        holder.key = newClientKey();
        holder.usedFor = null;
      } else {
        // failed / unknown: keep the key and do not send to this address again from here.
        setBlocked((previous) => new Set(previous).add(normalizeEmail(sent.to)));
      }
    });
  }

  const showInvalid = trimmed.length > 0 && !valid;
  const failed = result?.status === "result" && result.outcome === "failed";
  const isAlert = result?.status === "error" || result?.status === "refused" || failed;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={unresolved !== null || pending} className="flex flex-col gap-1.5">
        <Label htmlFor="email-test-to">{copy.to}</Label>
        <Input
          id="email-test-to"
          type="email"
          inputMode="email"
          autoComplete="off"
          dir="ltr"
          className="text-start"
          value={to}
          aria-invalid={showInvalid}
          aria-describedby={showInvalid ? "email-test-to-hint" : undefined}
          onChange={(event) => {
            setTo(event.target.value);
            setResult(null);
          }}
        />
        {showInvalid && (
          <p id="email-test-to-hint" className="text-destructive text-sm">
            {copy.toInvalid}
          </p>
        )}
      </fieldset>

      <div>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>

      {isBlocked && <p className="text-muted-foreground text-sm">{copy.blockedHint}</p>}
      {result !== null && (
        <p
          role={isAlert ? "alert" : "status"}
          className={isAlert ? "text-destructive text-sm" : "text-foreground text-sm"}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
