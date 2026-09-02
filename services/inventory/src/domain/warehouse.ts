import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { WarehouseDeactivated } from "./events/warehouse-deactivated.event";
import { WarehouseRegistered } from "./events/warehouse-registered.event";

export type WarehouseStatus = "active" | "inactive";

interface WarehouseProps {
  readonly code: string;
  name: string;
  status: WarehouseStatus;
}

/**
 * A lean warehouse registry entry (ADR-0013 scope: the registry only — stock itself stays on
 * `InventoryItem`, keyed `(tenant, product_ref, warehouse_id)`). `code` is unique per tenant.
 */
export class Warehouse extends AggregateRoot<WarehouseProps> {
  static register(
    id: UniqueEntityId,
    code: string,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): Warehouse {
    const warehouse = new Warehouse({ code, name, status: "active" }, id);
    warehouse.addDomainEvent(
      new WarehouseRegistered({ eventId, aggregateId: warehouse.id, occurredAt }, { code, name }),
    );
    return warehouse;
  }

  static reconstitute(
    id: UniqueEntityId,
    code: string,
    name: string,
    status: WarehouseStatus,
    version: number,
  ): Warehouse {
    return new Warehouse({ code, name, status }, id, version);
  }

  rename(name: string): void {
    this.props.name = name;
  }

  deactivate(eventId: string, occurredAt: Date): void {
    if (this.props.status === "inactive") {
      throw new BusinessRuleError("Warehouse is already inactive");
    }
    this.props.status = "inactive";
    this.addDomainEvent(
      new WarehouseDeactivated(
        { eventId, aggregateId: this.id, occurredAt },
        { code: this.props.code },
      ),
    );
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): WarehouseStatus {
    return this.props.status;
  }

  get active(): boolean {
    return this.props.status === "active";
  }
}
