export { type SecretProvider, BaseSecretProvider } from "./provider";
export { EnvSecretProvider } from "./env-provider";
export { ChainedSecretProvider } from "./chained-provider";
export { EnvelopeCipher, KeyAliasRegistry } from "./envelope";
export type { KeyWrapCipher, SealedEnvelope } from "./envelope";

import { EnvSecretProvider } from "./env-provider";
import type { SecretProvider } from "./provider";

/**
 * Default secret provider: environment variables + Docker/K8s `*_FILE` secrets.
 * A Vault-backed provider plugs in later by implementing `SecretProvider` and
 * composing via `ChainedSecretProvider` — no code here changes.
 */
export function createSecretProvider(env: NodeJS.ProcessEnv = process.env): SecretProvider {
  return new EnvSecretProvider(env);
}
