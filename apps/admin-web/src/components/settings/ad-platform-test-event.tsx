"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { sendAdPlatformTestEventAction } from "@/app/settings/ad-platforms/actions";
import {
  AD_PLATFORM_SPECS,
  type AdPlatformKey,
  type AdPlatformTestState,
  type TestEventFailure,
  type TestEventResultDto,
} from "@/lib/ad-platforms-model";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: AdPlatformTestState = { status: "idle" };

type Copy = Dictionary["adPlatformsSettings"];

/**
 * A sentence with `{platform}` and `{status}` filled in. The vendor name is a brand name: it is isolated in
 * `<bdi dir="auto">` so a Latin name never reorders an Arabic sentence (or the reverse); the number is isolated too.
 */
function Sentence({
  template,
  brand,
  status,
}: {
  readonly template: string;
  readonly brand: string;
  readonly status?: number | undefined;
}): ReactNode {
  return template.split(/(\{platform\}|\{status\})/).map((part, index) => {
    if (part === "{platform}") {
      return (
        <bdi key={index} dir="auto">
          {brand}
        </bdi>
      );
    }
    if (part === "{status}") {
      return (
        <bdi key={index} dir="ltr">
          {String(status ?? "")}
        </bdi>
      );
    }
    return part;
  });
}

function failureText(reason: TestEventFailure, copy: Copy, t: Dictionary): string {
  switch (reason) {
    case "not_connected":
      return copy.testNotConnected;
    case "code_required":
      return copy.testCodeRequired;
    case "not_supported":
      return copy.testNotSupported;
    case "invalid_code":
      return copy.testInvalidCode;
    case "rate_limited":
      return copy.testRateLimited;
    case "unavailable":
      return copy.testUnavailable;
    case "unauthorized":
      return t.formErrors.unauthorized;
    case "forbidden":
      return t.formErrors.forbidden;
    case "unexpected":
      return t.formErrors.unexpected;
  }
}

function ResultText({
  result,
  brand,
  copy,
}: {
  readonly result: TestEventResultDto;
  readonly brand: string;
  readonly copy: Copy;
}): ReactNode {
  if (result.status === "sent") {
    const template = result.platform === "ga4" ? copy.testSentCheck : copy.testSentCode;
    return (
      <p>
        <Sentence template={template} brand={brand} />
      </p>
    );
  }
  const messages = result.messages ?? [];
  if (messages.length > 0) {
    return (
      <div className="text-destructive flex flex-col gap-1">
        <p>
          <Sentence template={copy.testProblems} brand={brand} />
        </p>
        <ul className="list-disc ps-5">
          {messages.map((message, index) => (
            <li key={index}>
              <bdi dir="ltr">{message}</bdi>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const status = result.vendorStatus;
  const template =
    status === undefined
      ? copy.testRejectedNoAnswer
      : status === 401 || status === 403
        ? copy.testRejectedToken
        : copy.testRejectedStatus;
  return (
    <p className="text-destructive">
      <Sentence template={template} brand={brand} status={status} />
    </p>
  );
}

/**
 * Meta and TikTok keep a saved test code until it is cleared, and a saved code sends EVERY live event to the
 * platform's Test Events tool, where it is not counted for ads. Said where the code is entered, in plain words.
 */
export function AdPlatformTestCodeWarning({
  platform,
  t,
}: {
  readonly platform: AdPlatformKey;
  readonly t: Dictionary;
}) {
  const copy = t.adPlatformsSettings;
  return (
    <div
      role="note"
      data-testid={`ad-test-code-warning-${platform}`}
      className="border-border bg-warning-subtle text-warning-foreground flex items-start gap-2 rounded-lg border p-3 text-sm"
    >
      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <Sentence template={copy.testSavedCodeWarning} brand={AD_PLATFORM_SPECS[platform].label} />
      </p>
    </div>
  );
}

/**
 * "Send test event" for one platform. It is a plain button (the card's form is the SAVE form: a test never
 * saves) with its own action state. It sends the code typed in the card for this one test, or nothing when the
 * box is empty (then the saved code is used). The result region is always in the page and announces politely; the
 * button is disabled while the call runs, and keyboard focus is given back to it when the answer arrives.
 */
export function AdPlatformTestEvent({
  platform,
  typedCode,
  t,
}: {
  readonly platform: AdPlatformKey;
  /** What is typed in the card's test code box right now (saved or not); "" when there is none or no box. */
  readonly typedCode: string;
  readonly t: Dictionary;
}) {
  const copy = t.adPlatformsSettings;
  const spec = AD_PLATFORM_SPECS[platform];
  const [state, action, isPending] = useActionState(sendAdPlatformTestEventAction, INITIAL_STATE);
  const button = useRef<HTMLButtonElement>(null);
  const wantsFocus = useRef(false);

  useEffect(() => {
    if (state.status === "idle" || !wantsFocus.current) return;
    wantsFocus.current = false;
    const active = document.activeElement;
    // A disabled button drops focus to the page; give it back, but never take it from where the person went.
    if (active === null || active === document.body) button.current?.focus();
  }, [state]);

  const press = () => {
    const data = new FormData();
    data.set("platform", platform);
    const code = typedCode.trim();
    if (spec.testEventCode && code !== "") data.set("testEventCode", code);
    wantsFocus.current = document.activeElement === button.current;
    startTransition(() => action(data));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={button}
          type="button"
          variant="outline"
          size="sm"
          loading={isPending}
          onClick={press}
        >
          {isPending ? copy.testEventSending : copy.testEventButton}
        </Button>
      </div>
      <div
        aria-live="polite"
        data-testid={`ad-test-result-${platform}`}
        className="text-foreground text-sm"
      >
        {state.status === "done" && state.platform === platform && (
          <ResultText result={state.result} brand={spec.label} copy={copy} />
        )}
        {state.status === "failed" && state.platform === platform && (
          <p className="text-destructive">
            <Sentence template={failureText(state.reason, copy, t)} brand={spec.label} />
          </p>
        )}
      </div>
    </div>
  );
}
