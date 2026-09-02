import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { SnapshotCreated } from "./events/snapshot-created.event";
import type { Balance } from "./value-objects/balance";

interface FinancialSnapshotProps {
  readonly period: string;
  readonly currency: string;
  readonly figures: ReadonlyMap<string, Balance>;
}

/**
 * A point-in-time roll-up of key financial facts for a period (revenue, profit, cash position,
 * …) — a fact snapshot, not a recomputed metric (KPI ratios stay in Analytics, D-064).
 */
export class FinancialSnapshot extends AggregateRoot<FinancialSnapshotProps> {
  static create(
    id: UniqueEntityId,
    period: string,
    currency: string,
    figures: ReadonlyMap<string, Balance>,
    eventId: string,
    occurredAt: Date,
  ): FinancialSnapshot {
    const snapshot = new FinancialSnapshot({ period, currency, figures }, id);
    snapshot.addDomainEvent(
      new SnapshotCreated({ eventId, aggregateId: id, occurredAt }, { period, currency }),
    );
    return snapshot;
  }

  static reconstitute(
    id: UniqueEntityId,
    period: string,
    currency: string,
    figures: ReadonlyMap<string, Balance>,
    version: number,
  ): FinancialSnapshot {
    return new FinancialSnapshot({ period, currency, figures }, id, version);
  }

  figure(name: string): Balance | undefined {
    return this.props.figures.get(name);
  }

  get period(): string {
    return this.props.period;
  }

  get currency(): string {
    return this.props.currency;
  }

  get figures(): ReadonlyMap<string, Balance> {
    return this.props.figures;
  }
}
