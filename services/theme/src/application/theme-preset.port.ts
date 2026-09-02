import type { ThemeVariables } from "../domain/value-objects/theme-variables";

/** Outbound seam onto the Lumo Design System tokens — Theme seeds from them, never duplicates them. */
export interface DesignPresetProvider {
  getPreset(presetKey: string): Promise<ThemeVariables>;
}
