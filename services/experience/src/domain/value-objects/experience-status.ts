import { ValueObject } from "@platform/domain";

export type ExperienceStatusValue = "draft" | "published" | "archived";

const TRANSITIONS: Readonly<Record<ExperienceStatusValue, readonly ExperienceStatusValue[]>> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

export function canTransitionExperience(
  from: ExperienceStatusValue,
  to: ExperienceStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

interface ExperienceStatusProps {
  readonly value: ExperienceStatusValue;
}

/** The lifecycle state of an experience layout (draft→published→archived). */
export class ExperienceStatus extends ValueObject<ExperienceStatusProps> {
  static draft(): ExperienceStatus {
    return new ExperienceStatus({ value: "draft" });
  }

  static from(value: ExperienceStatusValue): ExperienceStatus {
    return new ExperienceStatus({ value });
  }

  get value(): ExperienceStatusValue {
    return this.props.value;
  }
}
