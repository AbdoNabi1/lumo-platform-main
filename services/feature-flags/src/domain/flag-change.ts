import { Entity, type UniqueEntityId } from "@platform/domain";

export type FlagChangeAction =
  "killed" | "revived" | "archived" | "rule_updated" | "rollout_changed";

interface FlagChangeProps {
  readonly action: FlagChangeAction;
  readonly changedBy: string;
  readonly details?: string;
  readonly occurredAt: Date;
}

/** An append-only audit-log entry for one config/lifecycle change to a flag (never rewritten). */
export class FlagChange extends Entity<FlagChangeProps> {
  static create(
    id: UniqueEntityId,
    action: FlagChangeAction,
    changedBy: string,
    occurredAt: Date,
    details?: string,
  ): FlagChange {
    return new FlagChange({ action, changedBy, details, occurredAt }, id);
  }

  get action(): FlagChangeAction {
    return this.props.action;
  }

  get changedBy(): string {
    return this.props.changedBy;
  }

  get details(): string | undefined {
    return this.props.details;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
