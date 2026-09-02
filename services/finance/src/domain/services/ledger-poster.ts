import {
  type Money,
  type UniqueEntityId,
  type BusinessRuleError,
  type ValidationError,
} from "@platform/domain";
import type { Result } from "@platform/types";
import { Journal } from "../journal";
import { JournalLine } from "../value-objects/journal-line";
import { LedgerDirection } from "../value-objects/ledger-direction";

export interface PostingAccounts {
  readonly revenue: string;
  readonly receivable: string;
  readonly cogs: string;
  readonly inventory: string;
  readonly refundContra: string;
  readonly expense: string;
  readonly cash: string;
  readonly fees: string;
}

/**
 * Journal Posting Engine — builds balanced {@link Journal}s from commerce-event templates
 * (sale/COGS/refund/expense/fee). Pure: never persists, never posts; the caller (application
 * layer) decides when to call `journal.post(...)`.
 */
export class LedgerPoster {
  static forSale(
    id: UniqueEntityId,
    sourceRef: string,
    accounts: PostingAccounts,
    amount: Money,
  ): Result<Journal, ValidationError | BusinessRuleError> {
    return Journal.create(id, sourceRef, amount.currency, [
      JournalLine.create(accounts.receivable, LedgerDirection.debit(), amount, "sale"),
      JournalLine.create(accounts.revenue, LedgerDirection.credit(), amount, "sale"),
    ]);
  }

  static forCogs(
    id: UniqueEntityId,
    sourceRef: string,
    accounts: PostingAccounts,
    cost: Money,
  ): Result<Journal, ValidationError | BusinessRuleError> {
    return Journal.create(id, sourceRef, cost.currency, [
      JournalLine.create(accounts.cogs, LedgerDirection.debit(), cost, "cogs"),
      JournalLine.create(accounts.inventory, LedgerDirection.credit(), cost, "cogs"),
    ]);
  }

  static forRefund(
    id: UniqueEntityId,
    sourceRef: string,
    accounts: PostingAccounts,
    amount: Money,
  ): Result<Journal, ValidationError | BusinessRuleError> {
    return Journal.create(id, sourceRef, amount.currency, [
      JournalLine.create(accounts.refundContra, LedgerDirection.debit(), amount, "refund"),
      JournalLine.create(accounts.receivable, LedgerDirection.credit(), amount, "refund"),
    ]);
  }

  static forExpense(
    id: UniqueEntityId,
    sourceRef: string,
    accounts: PostingAccounts,
    amount: Money,
  ): Result<Journal, ValidationError | BusinessRuleError> {
    return Journal.create(id, sourceRef, amount.currency, [
      JournalLine.create(accounts.expense, LedgerDirection.debit(), amount, "expense"),
      JournalLine.create(accounts.cash, LedgerDirection.credit(), amount, "expense"),
    ]);
  }

  static forFee(
    id: UniqueEntityId,
    sourceRef: string,
    accounts: PostingAccounts,
    amount: Money,
  ): Result<Journal, ValidationError | BusinessRuleError> {
    return Journal.create(id, sourceRef, amount.currency, [
      JournalLine.create(accounts.fees, LedgerDirection.debit(), amount, "fee"),
      JournalLine.create(accounts.cash, LedgerDirection.credit(), amount, "fee"),
    ]);
  }
}
