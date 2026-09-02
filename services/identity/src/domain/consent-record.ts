import { Entity, type UniqueEntityId } from "@platform/domain";
import type { ConsentScope } from "./value-objects/consent-scope";

interface ConsentRecordProps {
  readonly scope: ConsentScope;
  readonly granted: boolean;
  readonly occurredAt: Date;
}

/**
 * An append-only record of a consent grant/revocation. Current consent for a scope is **derived**
 * from the latest record — records are never mutated.
 */
export class ConsentRecord extends Entity<ConsentRecordProps> {
  static create(
    id: UniqueEntityId,
    scope: ConsentScope,
    granted: boolean,
    occurredAt: Date,
  ): ConsentRecord {
    return new ConsentRecord({ scope, granted, occurredAt }, id);
  }

  get scope(): ConsentScope {
    return this.props.scope;
  }

  get granted(): boolean {
    return this.props.granted;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
