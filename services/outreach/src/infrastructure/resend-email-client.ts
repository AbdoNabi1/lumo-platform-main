import type { EmailSendPort, SendOutcome } from "../application/ports";

export class ResendEmailClient implements EmailSendPort {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string;

  constructor(o: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  async send(m: Parameters<EmailSendPort["send"]>[0]): Promise<SendOutcome> {
    try {
      const response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": m.idempotencyKey,
        },
        body: JSON.stringify({
          from: m.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.replyTo === undefined ? {} : { reply_to: m.replyTo }),
          ...(m.headers === undefined ? {} : { headers: m.headers }),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status >= 500) return { kind: "unknown", message: "Email provider unavailable" };
      if (!response.ok)
        return {
          kind: "rejected",
          code: String(response.status),
          message: "Email provider rejected request",
          retryable: response.status === 429,
        };
      const data: unknown = await response.json();
      if (
        typeof data === "object" &&
        data !== null &&
        "id" in data &&
        typeof data.id === "string" &&
        data.id.length > 0
      )
        return { kind: "accepted", providerMessageId: data.id };
      return { kind: "unknown", message: "Email provider returned no message id" };
    } catch {
      return { kind: "unknown", message: "Email provider request failed" };
    }
  }
}
