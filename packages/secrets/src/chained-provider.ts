import { BaseSecretProvider, type SecretProvider } from "./provider";

/** Tries each provider in order; the first non-empty value wins. */
export class ChainedSecretProvider extends BaseSecretProvider {
  private readonly providers: readonly SecretProvider[];

  constructor(providers: readonly SecretProvider[]) {
    super();
    this.providers = providers;
  }

  get(key: string): string | undefined {
    for (const provider of this.providers) {
      const value = provider.get(key);
      if (value !== undefined && value !== "") {
        return value;
      }
    }
    return undefined;
  }
}
