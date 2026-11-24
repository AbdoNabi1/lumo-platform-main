import { DomainError } from "@platform/utils";

/** The merchant tried to store a secret but no real credential vault is configured (maps to HTTP 503). */
export class CredentialStorageUnavailableError extends DomainError {
  readonly retryable = false;

  constructor() {
    super("ad platform credential storage is not configured", { code: "UNAVAILABLE" });
  }
}
