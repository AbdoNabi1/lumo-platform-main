import {
  AggregateRoot,
  BusinessRuleError,
  type UniqueEntityId,
  ValidationError,
} from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type AccountType } from "./value-objects/account-type";

interface AccountProps {
  readonly code: string;
  name: string;
  readonly type: AccountType;
  active: boolean;
}

/** One entry in the chart of accounts. */
export class Account extends AggregateRoot<AccountProps> {
  static create(
    id: UniqueEntityId,
    code: string,
    name: string,
    type: AccountType,
  ): Result<Account, ValidationError> {
    if (code.trim().length === 0) {
      return err(
        new ValidationError("Invalid account", [{ field: "code", message: "must not be empty" }]),
      );
    }
    if (name.trim().length === 0) {
      return err(
        new ValidationError("Invalid account", [{ field: "name", message: "must not be empty" }]),
      );
    }
    return ok(new Account({ code, name, type, active: true }, id));
  }

  static reconstitute(
    id: UniqueEntityId,
    code: string,
    name: string,
    type: AccountType,
    active: boolean,
    version: number,
  ): Account {
    return new Account({ code, name, type, active }, id, version);
  }

  rename(name: string): void {
    if (name.trim().length === 0) {
      throw new BusinessRuleError("Account name must not be empty");
    }
    this.props.name = name;
  }

  archive(): void {
    this.props.active = false;
  }

  reactivate(): void {
    this.props.active = true;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get type(): AccountType {
    return this.props.type;
  }

  get active(): boolean {
    return this.props.active;
  }
}
