import { AggregateRoot, type UniqueEntityId, ValidationError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ExpenseCategoryProps {
  name: string;
  readonly costCenterRef: string | null;
}

/** A merchant-defined category expenses are classified under (e.g. "Marketing", "Rent"). */
export class ExpenseCategory extends AggregateRoot<ExpenseCategoryProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    costCenterRef: string | null = null,
  ): Result<ExpenseCategory, ValidationError> {
    if (name.trim().length === 0) {
      return err(
        new ValidationError("Invalid expense category", [
          { field: "name", message: "must not be empty" },
        ]),
      );
    }
    return ok(new ExpenseCategory({ name, costCenterRef }, id));
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    costCenterRef: string | null,
    version: number,
  ): ExpenseCategory {
    return new ExpenseCategory({ name, costCenterRef }, id, version);
  }

  rename(name: string): void {
    this.props.name = name;
  }

  get name(): string {
    return this.props.name;
  }

  get costCenterRef(): string | null {
    return this.props.costCenterRef;
  }
}
