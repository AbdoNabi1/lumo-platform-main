import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { SeoChanged } from "./events/seo-changed.event";
import type { RobotsRule } from "./value-objects/seo";

interface RobotsPolicyProps {
  readonly userAgent: string;
  rules: readonly RobotsRule[];
}

/** A robots.txt policy for one user agent. */
export class RobotsPolicy extends AggregateRoot<RobotsPolicyProps> {
  static create(
    id: UniqueEntityId,
    userAgent: string,
    eventId: string,
    occurredAt: Date,
  ): RobotsPolicy {
    const policy = new RobotsPolicy({ userAgent, rules: [] }, id);
    policy.raise("created", eventId, occurredAt);
    return policy;
  }

  static reconstitute(
    id: UniqueEntityId,
    userAgent: string,
    rules: readonly RobotsRule[],
    version: number,
  ): RobotsPolicy {
    return new RobotsPolicy({ userAgent, rules }, id, version);
  }

  setRules(rules: readonly RobotsRule[], eventId: string, occurredAt: Date): void {
    this.props.rules = rules;
    this.raise("updated", eventId, occurredAt);
  }

  private raise(
    action: "created" | "updated" | "deleted",
    eventId: string,
    occurredAt: Date,
  ): void {
    this.addDomainEvent(
      new SeoChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.userAgent,
          entityType: "robots_policy",
          action,
        },
      ),
    );
  }

  get userAgent(): string {
    return this.props.userAgent;
  }

  get rules(): readonly RobotsRule[] {
    return this.props.rules;
  }
}
