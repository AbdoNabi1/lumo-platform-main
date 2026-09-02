import { ValueObject } from "@platform/domain";

interface RewardTierProps {
  readonly name: string;
  readonly minimumPoints: number;
}

/** One rung of the reward-tier ladder — a name and the points balance required to reach it. */
export class RewardTier extends ValueObject<RewardTierProps> {
  static create(name: string, minimumPoints: number): RewardTier {
    return new RewardTier({ name, minimumPoints });
  }

  get name(): string {
    return this.props.name;
  }

  get minimumPoints(): number {
    return this.props.minimumPoints;
  }
}

/** Resolves the highest tier a points balance qualifies for. `tiers` need not be pre-sorted. */
export function resolveTier(balance: number, tiers: readonly RewardTier[]): RewardTier {
  const sorted = [...tiers].sort((a, b) => a.minimumPoints - b.minimumPoints);
  let current = sorted[0];
  for (const tier of sorted) {
    if (balance >= tier.minimumPoints) current = tier;
  }
  if (current === undefined) {
    throw new Error("resolveTier requires at least one tier");
  }
  return current;
}
