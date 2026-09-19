import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { NotFoundError } from "@platform/utils";
import { Warehouse } from "../domain/warehouse";
import type { WarehouseRepository } from "../domain/warehouse-repository";

export interface RegisterWarehouseInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
}

export interface WarehouseOutput {
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface WarehouseUseCaseDeps {
  readonly warehouses: WarehouseRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Registers a new warehouse. `code` must be unique per tenant (enforced via `findByCode`). */
export class RegisterWarehouse implements UseCase<
  RegisterWarehouseInput,
  WarehouseOutput,
  DomainError
> {
  private readonly deps: WarehouseUseCaseDeps;

  constructor(deps: WarehouseUseCaseDeps) {
    this.deps = deps;
  }

  async execute(input: RegisterWarehouseInput): Promise<Result<WarehouseOutput, DomainError>> {
    const code = Guard.againstEmpty(input.code, "code");
    if (!code.ok) return err(code.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<WarehouseOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.warehouses.findByCode(input.code, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Warehouse code '${input.code}' is already registered`));
      }

      const warehouse = Warehouse.register(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        input.code,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.warehouses.save(warehouse, input.tenantId, tx);

      return ok({
        warehouseId: warehouse.id.toString(),
        code: warehouse.code,
        name: warehouse.name,
        status: warehouse.status,
      });
    });
  }
}

export interface DeactivateWarehouseInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly warehouseId: string;
}

/** Deactivates a warehouse; rejects an already-inactive one (`BusinessRuleError`, 409). */
export class DeactivateWarehouse implements UseCase<
  DeactivateWarehouseInput,
  WarehouseOutput,
  DomainError
> {
  private readonly deps: WarehouseUseCaseDeps;

  constructor(deps: WarehouseUseCaseDeps) {
    this.deps = deps;
  }

  async execute(input: DeactivateWarehouseInput): Promise<Result<WarehouseOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WarehouseOutput, DomainError>>(async (tx) => {
      const warehouse = await this.deps.warehouses.findById(input.warehouseId, input.tenantId, tx);
      if (warehouse === null) {
        return err(new NotFoundError("Warehouse not found"));
      }

      try {
        warehouse.deactivate(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.warehouses.save(warehouse, input.tenantId, tx);
      return ok({
        warehouseId: warehouse.id.toString(),
        code: warehouse.code,
        name: warehouse.name,
        status: warehouse.status,
      });
    });
  }
}
