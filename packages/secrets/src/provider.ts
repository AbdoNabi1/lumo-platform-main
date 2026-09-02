import { AppError } from "@platform/utils";

/** Reads secret values by key. Implementations: env, Docker files, (future) Vault. */
export interface SecretProvider {
  /** Returns the secret value, or `undefined` if not present. */
  get(key: string): string | undefined;
  /** Returns the secret value or throws if missing/empty. */
  require(key: string): string;
}

/** Shared `require` semantics so each provider only implements `get`. */
export abstract class BaseSecretProvider implements SecretProvider {
  abstract get(key: string): string | undefined;

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined || value === "") {
      throw new AppError(`Missing required secret: ${key}`, { code: "SECRET_MISSING" });
    }
    return value;
  }
}
