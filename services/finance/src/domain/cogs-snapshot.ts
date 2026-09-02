import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import type { CostComponent } from "./value-objects/cost-component";

interface CogsSnapshotProps {
  readonly productRef: string;
  readonly components: readonly CostComponent[];
  readonly effectiveAt: Date;
}

/**
 * An immutable, effective-dated landed-cost record for a product — never updated. A cost change
 * is a new snapshot, so historical COGS/margin never change (mirrors {@link ExchangeRate}).
 */
export class CogsSnapshot extends AggregateRoot<CogsSnapshotProps> {
  static record(
    id: UniqueEntityId,
    productRef: string,
    components: readonly CostComponent[],
    effectiveAt: Date,
  ): CogsSnapshot {
    return new CogsSnapshot({ productRef, components: [...components], effectiveAt }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    productRef: string,
    components: readonly CostComponent[],
    effectiveAt: Date,
    version: number,
  ): CogsSnapshot {
    return new CogsSnapshot({ productRef, components: [...components], effectiveAt }, id, version);
  }

  get productRef(): string {
    return this.props.productRef;
  }

  get components(): readonly CostComponent[] {
    return this.props.components;
  }

  get effectiveAt(): Date {
    return this.props.effectiveAt;
  }

  get totalMinor(): number {
    return this.props.components.reduce((sum, c) => sum + c.amount.amountMinor, 0);
  }
}
