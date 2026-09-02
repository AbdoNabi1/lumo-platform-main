import { ValueObject } from "@platform/domain";

interface ThemeVariablesProps {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
}

/** A theme's appearance variables — seeded from `@platform/design` tokens (read-only), never duplicated. */
export class ThemeVariables extends ValueObject<ThemeVariablesProps> {
  static create(
    colors: Readonly<Record<string, string>>,
    typography: Readonly<Record<string, string>>,
    spacing: Readonly<Record<string, string>>,
  ): ThemeVariables {
    return new ThemeVariables({ colors, typography, spacing });
  }

  get colors(): Readonly<Record<string, string>> {
    return this.props.colors;
  }

  get typography(): Readonly<Record<string, string>> {
    return this.props.typography;
  }

  get spacing(): Readonly<Record<string, string>> {
    return this.props.spacing;
  }
}
