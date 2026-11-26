import type {
  StoreEmailCredentials,
  StoreEmailFailureCode,
  StoreEmailMessage,
  StoreEmailProvider,
  StoreEmailResult,
} from "../application/email-connection-ports";

export interface RecordedStoreEmail {
  readonly credentials: StoreEmailCredentials;
  readonly message: StoreEmailMessage;
}

/**
 * Offline/test twin of a merchant's email provider: records every call (including which key it was
 * called with, so a test can prove it was the STORE's key) and answers `ok`, or a scripted refusal.
 * Never used in production.
 */
export class InMemoryStoreEmailProvider implements StoreEmailProvider {
  readonly calls: RecordedStoreEmail[] = [];
  private readonly scripted: StoreEmailResult[] = [];
  private readonly rejectedKeys = new Set<string>();
  private thrownNext = false;

  /** The next call answers this refusal (then it is back to `ok`). */
  failNext(code: StoreEmailFailureCode, message = "The provider refused this request"): void {
    this.scripted.push({ ok: false, code, message });
  }

  /** The next call THROWS (a defect in an adapter must not break the pipeline or leak). */
  throwNext(): void {
    this.thrownNext = true;
  }

  /** Every call with this key is refused as a rejected key. */
  rejectKey(apiKey: string): void {
    this.rejectedKeys.add(apiKey);
  }

  send(credentials: StoreEmailCredentials, message: StoreEmailMessage): Promise<StoreEmailResult> {
    this.calls.push({ credentials, message });
    if (this.thrownNext) {
      this.thrownNext = false;
      return Promise.reject(new Error(`boom using ${credentials.apiKey}`));
    }
    const next = this.scripted.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (this.rejectedKeys.has(credentials.apiKey)) {
      return Promise.resolve({
        ok: false,
        code: "EMAIL_KEY_REJECTED",
        message: "The API key is invalid",
      });
    }
    return Promise.resolve({ ok: true });
  }

  /** The idempotency keys of the calls so far, in order. */
  idempotencyKeys(): readonly (string | undefined)[] {
    return this.calls.map((call) => call.message.idempotencyKey);
  }
}
