/**
 * Feature-flag infrastructure (foundation only — NO flags are defined here).
 * Implements the provider contract; later sprints register real providers/flags.
 * Aligns with docs/architecture/12-feature-flags-and-configuration.md.
 */

export interface FlagContext {
  readonly userId?: string;
  readonly attributes?: Record<string, string | number | boolean>;
}

export interface FlagProvider {
  isEnabled(key: string, context?: FlagContext): boolean;
  getVariant(key: string, context?: FlagContext): string | undefined;
}

/** Default provider: everything off. Safe baseline until a real provider is wired. */
export class StaticFlagProvider implements FlagProvider {
  private readonly values: ReadonlyMap<string, boolean>;

  constructor(values: Readonly<Record<string, boolean>> = {}) {
    this.values = new Map(Object.entries(values));
  }

  isEnabled(key: string): boolean {
    return this.values.get(key) ?? false;
  }

  getVariant(): string | undefined {
    return undefined;
  }
}

let activeProvider: FlagProvider = new StaticFlagProvider();

export function setFlagProvider(provider: FlagProvider): void {
  activeProvider = provider;
}

export function isEnabled(key: string, context?: FlagContext): boolean {
  return activeProvider.isEnabled(key, context);
}

export function getVariant(key: string, context?: FlagContext): string | undefined {
  return activeProvider.getVariant(key, context);
}
