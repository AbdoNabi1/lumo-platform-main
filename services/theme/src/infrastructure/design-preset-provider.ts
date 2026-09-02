import type { DesignPresetProvider } from "../application/theme-preset.port";
import type { ThemeVariables } from "../domain/value-objects/theme-variables";
import { resolveDesignTokenPreset } from "./design-token-presets";

/** In-memory adapter for `DesignPresetProvider` — resolves presets directly from the `@platform/design` tokens. */
export class InMemoryDesignPresetProvider implements DesignPresetProvider {
  async getPreset(presetKey: string): Promise<ThemeVariables> {
    return resolveDesignTokenPreset(presetKey);
  }
}
