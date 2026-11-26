import { DomainError } from "@platform/utils";

/** The server can't store or use email credentials (no KEK / no provider): the presenter answers 503. */
export class EmailConnectionUnavailableError extends DomainError {
  readonly retryable = false;
  constructor() {
    super("Not available yet", { code: "NOT_CONFIGURED" });
  }
}

/**
 * The store has no working email connection (D46/D51): nothing is sent, and there is no platform
 * fallback. The presenter answers 503 with code `EMAIL_NOT_CONNECTED`.
 */
export class EmailNotConnectedError extends DomainError {
  readonly retryable = false;
  constructor(message = "Your store's email account isn't connected, so no email can be sent") {
    super(message, { code: "EMAIL_NOT_CONNECTED" });
  }
}

/** The merchant's own provider refused a send. The message is the provider's, sanitized (no key, no address). */
export class EmailProviderRefusedError extends DomainError {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message, { code: "PROVIDER_ERROR" });
    this.retryable = retryable;
  }
}
