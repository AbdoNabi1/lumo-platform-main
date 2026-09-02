import { AggregateRoot, type UniqueEntityId, ValidationError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CostCenterProps {
  readonly code: string;
  name: string;
  active: boolean;
}

/** An organizational unit expenses/budgets are attributed to. */
export class CostCenter extends AggregateRoot<CostCenterProps> {
  static create(
    id: UniqueEntityId,
    code: string,
    name: string,
  ): Result<CostCenter, ValidationError> {
    if (code.trim().length === 0 || name.trim().length === 0) {
      return err(
        new ValidationError("Invalid cost center", [
          { field: code.trim().length === 0 ? "code" : "name", message: "must not be empty" },
        ]),
      );
    }
    return ok(new CostCenter({ code, name, active: true }, id));
  }

  static reconstitute(
    id: UniqueEntityId,
    code: string,
    name: string,
    active: boolean,
    version: number,
  ): CostCenter {
    return new CostCenter({ code, name, active }, id, version);
  }

  rename(name: string): void {
    this.props.name = name;
  }

  archive(): void {
    this.props.active = false;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get active(): boolean {
    return this.props.active;
  }
}
