"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@platform/ui";
import { connectWhatsAppAction } from "@/app/settings/whatsapp/actions";
import type { WhatsAppSignupDto } from "@/lib/api/outreach";
import { META_ID_PATTERN } from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";
import { BrandText } from "./brand-text";

/**
 * Embedded Signup v4. The merchant signs in with Facebook in a popup; Meta answers twice:
 *  - `FB.login`'s callback carries the one-time `code`;
 *  - a `message` event from facebook.com carries the chosen WhatsApp business account and phone number.
 * Only when BOTH exist (in either order) does the one server action run, once per attempt.
 */

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const SDK_TAG_ID = "facebook-jssdk";
/** Exact origins only — a prefix, suffix or look-alike host is not Meta. */
const META_ORIGINS: readonly string[] = ["https://www.facebook.com", "https://web.facebook.com"];

interface LoginResponse {
  readonly authResponse?: { readonly code?: unknown } | null;
}
interface FacebookSdk {
  init(options: { appId: string; version: string; xfbml: boolean }): void;
  login(
    callback: (response: LoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: { setup: Record<string, never> };
    },
  ): void;
}

function currentSdk(): FacebookSdk | null {
  const fb = (window as unknown as { FB?: FacebookSdk }).FB;
  return fb !== undefined && typeof fb.init === "function" && typeof fb.login === "function"
    ? fb
    : null;
}

/** Loads the Facebook SDK once (async); resolves with `window.FB`, rejects when the script cannot be loaded. */
function loadFacebookSdk(): Promise<FacebookSdk> {
  const ready = currentSdk();
  if (ready !== null) return Promise.resolve(ready);
  return new Promise<FacebookSdk>((resolve, reject) => {
    let script = document.getElementById(SDK_TAG_ID) as HTMLScriptElement | null;
    if (script === null) {
      script = document.createElement("script");
      script.id = SDK_TAG_ID;
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    const tag = script;
    tag.addEventListener(
      "load",
      () => {
        const sdk = currentSdk();
        if (sdk !== null) {
          resolve(sdk);
          return;
        }
        tag.remove();
        reject(new Error("sdk-missing"));
      },
      { once: true },
    );
    tag.addEventListener(
      "error",
      () => {
        // A failed tag must not block the retry from creating a fresh one.
        tag.remove();
        reject(new Error("sdk-load"));
      },
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SignupMessage =
  | { readonly kind: "finish"; readonly wabaId: string; readonly phoneNumberId: string }
  | { readonly kind: "unsupported" }
  | { readonly kind: "cancel" }
  | { readonly kind: "error" };

/** Reads one `message` event; `null` for anything that is not an Embedded Signup message from Meta. */
function readSignupMessage(event: MessageEvent): SignupMessage | null {
  if (!META_ORIGINS.includes(event.origin)) return null;
  // v4 delivers the payload as a JSON string; a guard keeps a malformed one from throwing in the handler.
  if (typeof event.data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["type"] !== "WA_EMBEDDED_SIGNUP") return null;
  const name = parsed["event"];
  if (name === "CANCEL") return { kind: "cancel" };
  if (name === "ERROR") return { kind: "error" };
  if (name === "FINISH") {
    const data = isRecord(parsed["data"]) ? parsed["data"] : {};
    const wabaId = data["waba_id"];
    const phoneNumberId = data["phone_number_id"];
    if (
      typeof wabaId === "string" &&
      typeof phoneNumberId === "string" &&
      META_ID_PATTERN.test(wabaId) &&
      META_ID_PATTERN.test(phoneNumberId)
    ) {
      return { kind: "finish", wabaId, phoneNumberId };
    }
    // FINISH without a phone number: not a WhatsApp Business Platform number.
    return { kind: "unsupported" };
  }
  // FINISH_ONLY_WABA and every other FINISH_* variant are setups this platform does not support.
  if (typeof name === "string" && name.startsWith("FINISH")) return { kind: "unsupported" };
  return null;
}

interface Attempt {
  code: string | null;
  ids: { wabaId: string; phoneNumberId: string } | null;
  fired: boolean;
  ended: boolean;
}

type Phase = "idle" | "loading" | "waiting" | "connecting" | "connected";
type Notice = { readonly tone: "info" | "error"; readonly text: string } | null;

export function EmbeddedSignupButton({
  signup,
  label,
  t,
  variant = "primary",
}: {
  readonly signup: WhatsAppSignupDto;
  readonly label: string;
  readonly t: Dictionary;
  readonly variant?: "primary" | "outline";
}) {
  const copy = t.whatsappSettings;
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<Notice>(null);
  const [sdkFailed, setSdkFailed] = useState(false);
  const attemptRef = useRef<Attempt | null>(null);
  const mountedRef = useRef(true);
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const completeRef = useRef<(attempt: Attempt) => void>(() => undefined);

  function finish(attempt: Attempt, next: Notice, phaseAfter: Phase = "idle") {
    attempt.ended = true;
    if (!mountedRef.current || attemptRef.current !== attempt) return;
    setNotice(next);
    setPhase(phaseAfter);
  }

  function complete(attempt: Attempt) {
    if (attempt.ended || attempt.fired || attempt.code === null || attempt.ids === null) return;
    attempt.fired = true;
    setNotice({ tone: "info", text: copy.signupConnecting });
    setPhase("connecting");
    const input = {
      code: attempt.code,
      wabaId: attempt.ids.wabaId,
      phoneNumberId: attempt.ids.phoneNumberId,
    };
    connectWhatsAppAction(input).then(
      (result) => {
        if (result.status === "success") {
          finish(attempt, { tone: "info", text: copyRef.current.signupConnected }, "connected");
        } else {
          finish(attempt, { tone: "error", text: result.message });
        }
      },
      () => finish(attempt, { tone: "error", text: copyRef.current.errors.generic }),
    );
  }

  // The listener is registered once and removed on unmount; what it does depends on the CURRENT attempt only.
  useEffect(() => {
    mountedRef.current = true;
    function onMessage(event: MessageEvent) {
      const attempt = attemptRef.current;
      if (attempt === null || attempt.ended || attempt.fired) return;
      const message = readSignupMessage(event);
      if (message === null) return;
      if (message.kind === "finish") {
        if (attempt.ids !== null) return; // a repeated FINISH
        attempt.ids = { wabaId: message.wabaId, phoneNumberId: message.phoneNumberId };
        completeRef.current(attempt);
      } else if (message.kind === "unsupported") {
        finish(attempt, { tone: "error", text: copyRef.current.signupUnsupported });
      } else if (message.kind === "cancel") {
        finish(attempt, { tone: "info", text: copyRef.current.signupCancelled });
      } else {
        finish(attempt, { tone: "error", text: copyRef.current.signupFailed });
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("message", onMessage);
    };
  }, []);
  completeRef.current = complete;

  async function start() {
    if (attemptRef.current !== null && !attemptRef.current.ended) return;
    // Each attempt starts clean: the previous code and ids can never complete a new attempt.
    const attempt: Attempt = { code: null, ids: null, fired: false, ended: false };
    attemptRef.current = attempt;
    setNotice(null);
    setSdkFailed(false);
    setPhase("loading");
    let sdk: FacebookSdk;
    try {
      sdk = await loadFacebookSdk();
    } catch {
      if (attemptRef.current !== attempt || !mountedRef.current) return;
      attempt.ended = true;
      setSdkFailed(true);
      setNotice({ tone: "error", text: copyRef.current.signupLoadFailed });
      setPhase("idle");
      return;
    }
    if (attemptRef.current !== attempt || !mountedRef.current) return;
    sdk.init({ appId: signup.appId, version: signup.graphApiVersion, xfbml: false });
    setPhase("waiting");
    sdk.login(
      (response) => {
        if (attemptRef.current !== attempt || attempt.ended || attempt.fired) return;
        const code = response?.authResponse?.code;
        if (typeof code === "string" && code.length > 0) {
          attempt.code = code;
          completeRef.current(attempt);
        } else {
          finish(attempt, { tone: "info", text: copyRef.current.signupCancelled });
        }
      },
      {
        config_id: signup.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  const busy = phase === "loading" || phase === "waiting" || phase === "connecting";
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={variant}
          disabled={busy || phase === "connected"}
          onClick={() => void start()}
        >
          <BrandText text={label} />
        </Button>
        {sdkFailed && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void start()}>
            {copy.signupRetry}
          </Button>
        )}
      </div>
      {phase === "loading" && (
        <p role="status" className="text-muted-foreground text-sm">
          <BrandText text={copy.signupLoading} />
        </p>
      )}
      {notice !== null && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"
          }
        >
          <BrandText text={notice.text} />
        </p>
      )}
    </div>
  );
}
