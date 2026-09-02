import { ValueObject } from "@platform/domain";

export type AccountTypeValue = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalSide = "debit" | "credit";

const DEBIT_NORMAL: ReadonlySet<AccountTypeValue> = new Set(["asset", "expense"]);

/**
 * Chart-of-accounts category. Determines an account's normal balance side (debit-normal for
 * asset/expense, credit-normal for liability/equity/revenue) — the sign convention every other
 * Finance calculation (trial balance, statements) is derived from.
 */
export class AccountType extends ValueObject<{ readonly value: AccountTypeValue }> {
  static asset(): AccountType {
    return new AccountType({ value: "asset" });
  }

  static liability(): AccountType {
    return new AccountType({ value: "liability" });
  }

  static equity(): AccountType {
    return new AccountType({ value: "equity" });
  }

  static revenue(): AccountType {
    return new AccountType({ value: "revenue" });
  }

  static expense(): AccountType {
    return new AccountType({ value: "expense" });
  }

  static from(value: AccountTypeValue): AccountType {
    return new AccountType({ value });
  }

  get value(): AccountTypeValue {
    return this.props.value;
  }

  get normalSide(): NormalSide {
    return DEBIT_NORMAL.has(this.props.value) ? "debit" : "credit";
  }
}
