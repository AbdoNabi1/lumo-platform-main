import { ValueObject } from "@platform/domain";

export type AutomationTriggerType = "event" | "scheduled";

interface AutomationTriggerProps {
  readonly type: AutomationTriggerType;
  readonly eventType?: string;
  readonly cronExpression?: string;
}

/** What starts a workflow — an event type or a cron schedule. */
export class AutomationTrigger extends ValueObject<AutomationTriggerProps> {
  static event(eventType: string): AutomationTrigger {
    return new AutomationTrigger({ type: "event", eventType });
  }

  static scheduled(cronExpression: string): AutomationTrigger {
    return new AutomationTrigger({ type: "scheduled", cronExpression });
  }

  get type(): AutomationTriggerType {
    return this.props.type;
  }

  get eventType(): string | undefined {
    return this.props.eventType;
  }

  get cronExpression(): string | undefined {
    return this.props.cronExpression;
  }
}

interface AutomationActionProps {
  readonly actionType: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** One dispatched action of a workflow — routed through `ActionDispatcherPort`, never called directly. */
export class AutomationAction extends ValueObject<AutomationActionProps> {
  static create(
    actionType: string,
    params: Readonly<Record<string, unknown>> = {},
  ): AutomationAction {
    return new AutomationAction({ actionType, params });
  }

  get actionType(): string {
    return this.props.actionType;
  }

  get params(): Readonly<Record<string, unknown>> {
    return this.props.params;
  }
}
