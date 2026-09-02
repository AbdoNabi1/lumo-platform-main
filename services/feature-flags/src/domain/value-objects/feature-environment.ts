import { ValueObject } from "@platform/domain";

interface FeatureEnvironmentProps {
  readonly environment: string;
  readonly enabled: boolean;
  readonly rolloutPercentage?: number;
}

/** A per-environment override for a flag (e.g. force-off in `staging`, partial rollout in `production`). */
export class FeatureEnvironment extends ValueObject<FeatureEnvironmentProps> {
  static create(
    environment: string,
    enabled: boolean,
    rolloutPercentage?: number,
  ): FeatureEnvironment {
    return new FeatureEnvironment({ environment, enabled, rolloutPercentage });
  }

  get environment(): string {
    return this.props.environment;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get rolloutPercentage(): number | undefined {
    return this.props.rolloutPercentage;
  }
}
