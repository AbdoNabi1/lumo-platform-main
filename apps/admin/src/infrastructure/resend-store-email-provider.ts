import {
  sanitizeProviderMessage,
  type StoreEmailCredentials,
  type StoreEmailFailureCode,
  type StoreEmailMessage,
  type StoreEmailProvider,
  type StoreEmailResult,
} from "@platform/notifications";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const FALLBACK: Readonly<Record<StoreEmailFailureCode, string>> = {
  EMAIL_KEY_REJECTED: "Your email provider didn't accept the API key.",
  EMAIL_SENDER_REJECTED: "Your email provider didn't accept the sender address.",
  EMAIL_REQUEST_REJECTED: "Your email provider didn't accept this email.",
  EMAIL_RATE_LIMITED: "Your email provider is limiting requests. Try again in a moment.",
  EMAIL_PROVIDER_UNAVAILABLE: "We couldn't reach your email provider. Try again in a moment.",
  EMAIL_TIMEOUT: "Your email provider took too long to answer. Try again in a moment.",
};

function fail(
  code: StoreEmailFailureCode,
  providerText: unknown,
  apiKey: string,
): StoreEmailResult {
  return {
    ok: false,
    code,
    message: sanitizeProviderMessage(providerText, FALLBACK[code], [apiKey]),
  };
}

/** Resend answers `{ statusCode, name, message }`; anything else is unreadable and gets the fixed text. */
async function readProblem(response: Response): Promise<{ name: string; message: string }> {
  try {
    const body = (await response.json()) as { name?: unknown; message?: unknown };
    return {
      name: typeof body.name === "string" ? body.name : "",
      message: typeof body.message === "string" ? body.message : "",
    };
  } catch {
    return { name: "", message: "" };
  }
}

function codeFor(
  status: number,
  problem: { name: string; message: string },
): StoreEmailFailureCode {
  if (status === 401) return "EMAIL_KEY_REJECTED";
  if (status === 429) return "EMAIL_RATE_LIMITED";
  if (status >= 500) return "EMAIL_PROVIDER_UNAVAILABLE";
  const aboutSender = /domain|verif|from/i.test(problem.message);
  if (status === 403) {
    // 403 is "domain not verified" (the sender) or a restricted/invalid key: read which.
    return aboutSender && !/restricted|api key/i.test(`${problem.name} ${problem.message}`)
      ? "EMAIL_SENDER_REJECTED"
      : "EMAIL_KEY_REJECTED";
  }
  if (status === 409 && /concurrent/i.test(`${problem.name} ${problem.message}`)) {
    return "EMAIL_PROVIDER_UNAVAILABLE";
  }
  if (
    (status === 400 || status === 422) &&
    /domain.*(not )?verif|not verified/i.test(problem.message)
  ) {
    return "EMAIL_SENDER_REJECTED";
  }
  return "EMAIL_REQUEST_REJECTED";
}

/**
 * Wave 2b2 (D47): sends through the MERCHANT's own Resend account over HTTPS. The key arrives with each
 * call (the store's), and this adapter holds NO platform key: it cannot send a store's mail through
 * Morbeh's account even by mistake. From must be on a domain verified in the merchant's own Resend
 * account: Resend refuses otherwise and its (sanitized) message is what the merchant sees.
 *
 * 10 s timeout (a hung provider must not hold an order open, D42). The `Idempotency-Key` is passed
 * through, so a retry of the same notification sends once. Failures are `{ ok: false }` with a code and
 * a sanitized message (no key, no address, no Bearer token); nothing the network threw is kept.
 */
export class ResendStoreEmailProvider implements StoreEmailProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(options: { readonly fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(
    credentials: StoreEmailCredentials,
    message: StoreEmailMessage,
  ): Promise<StoreEmailResult> {
    const { apiKey } = credentials;
    if (credentials.kind !== "resend") return fail("EMAIL_REQUEST_REJECTED", undefined, apiKey);
    let response: Response;
    try {
      response = await this.fetchImpl(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(message.idempotencyKey === undefined
            ? {}
            : { "idempotency-key": message.idempotencyKey }),
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return fail(
        name === "TimeoutError" || name === "AbortError"
          ? "EMAIL_TIMEOUT"
          : "EMAIL_PROVIDER_UNAVAILABLE",
        undefined,
        apiKey,
      );
    }
    if (response.ok) return { ok: true };
    const problem = await readProblem(response);
    return fail(codeFor(response.status, problem), problem.message, apiKey);
  }
}
