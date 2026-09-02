import { ValueObject } from "@platform/domain";

interface ComponentContractProps {
  readonly slots: readonly string[];
  readonly events: readonly string[];
  readonly responsive: boolean;
  readonly permission?: string;
}

/** Carries a component's slots/events/responsive/permission contract — Experience owns instances, Components owns this contract. */
export class ComponentContract extends ValueObject<ComponentContractProps> {
  static create(props: ComponentContractProps): ComponentContract {
    return new ComponentContract(props);
  }

  get slots(): readonly string[] {
    return this.props.slots;
  }

  get events(): readonly string[] {
    return this.props.events;
  }

  get responsive(): boolean {
    return this.props.responsive;
  }

  get permission(): string | undefined {
    return this.props.permission;
  }
}
