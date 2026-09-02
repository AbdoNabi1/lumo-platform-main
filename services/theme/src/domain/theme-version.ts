import { Entity, type UniqueEntityId } from "@platform/domain";
import type { ThemeVariables } from "./value-objects/theme-variables";

interface ThemeVersionProps {
  readonly versionNumber: number;
  readonly variables: ThemeVariables;
  readonly publishedAt: Date;
}

/** An append-only published-version snapshot of a theme's variables (never rewritten). */
export class ThemeVersion extends Entity<ThemeVersionProps> {
  static create(
    id: UniqueEntityId,
    versionNumber: number,
    variables: ThemeVariables,
    publishedAt: Date,
  ): ThemeVersion {
    return new ThemeVersion({ versionNumber, variables, publishedAt }, id);
  }

  get versionNumber(): number {
    return this.props.versionNumber;
  }

  get variables(): ThemeVariables {
    return this.props.variables;
  }

  get publishedAt(): Date {
    return this.props.publishedAt;
  }
}
