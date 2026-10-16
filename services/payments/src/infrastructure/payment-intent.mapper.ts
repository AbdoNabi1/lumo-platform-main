import { Money, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Charge } from "../domain/charge";
import {
  PaymentAttempt,
  type PaymentAttemptKind,
  type PaymentAttemptOutcome,
} from "../domain/payment-attempt";
import { PaymentIntent } from "../domain/payment-intent";
import { isWellFormedProviderKey } from "../domain/value-objects/payment-provider-key";
import { PaymentMethod, PspReference } from "../domain/value-objects/payment-references";
import { PaymentStatus, type PaymentStatusValue } from "../domain/value-objects/payment-status";
import { PspToken } from "../domain/value-objects/psp-token";
import { Refund, type RefundStatus } from "../domain/refund";

export interface PaymentIntentRow {
  readonly id: string;
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: string;
  readonly pspReference: string | null;
  readonly provider: string;
  readonly providerTransactionRef: string | null;
  readonly paymentMethod: PaymentMethodJson | Record<string, never>;
  readonly authorizedAmountMinor: number | null;
  readonly version: number;
}
export interface ChargeRow {
  readonly id: string;
  readonly pspToken: string;
  readonly amountMinor: number;
  readonly occurredAt: Date;
}
export interface RefundRow {
  readonly id: string;
  readonly amountMinor: number;
  readonly status: string;
  readonly occurredAt: Date;
  readonly idempotencyKey?: string | null;
}
export interface AttemptRow {
  readonly id: string;
  readonly kind: string;
  readonly outcome: string;
  readonly reference: string | null;
  readonly occurredAt: Date;
}
export interface PaymentMethodJson {
  readonly token: string;
  readonly brand?: string;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt payments row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

function isSet<T extends object>(value: T | Record<string, never>): value is T {
  return Object.keys(value).length > 0;
}

/** Persistence ↔ aggregate mapping for {@link PaymentIntent}. Mapping only — no I/O. */
export class PaymentIntentMapper {
  static toDomain(
    row: PaymentIntentRow,
    charges: readonly ChargeRow[],
    refunds: readonly RefundRow[],
    attempts: readonly AttemptRow[] = [],
  ): PaymentIntent {
    if (!isWellFormedProviderKey(row.provider)) {
      throw new UnexpectedError(`Corrupt payments row: unknown provider "${row.provider}"`);
    }
    return PaymentIntent.reconstitute(
      UniqueEntityId.from(row.id),
      row.orderRef,
      must(Money.create(row.amountMinor, row.currency), "intent amount"),
      PaymentStatus.from(row.status as PaymentStatusValue),
      charges.map((c) =>
        Charge.create(
          UniqueEntityId.from(c.id),
          must(Money.create(c.amountMinor, row.currency), "charge amount"),
          must(PspToken.create(c.pspToken), "psp token"),
          c.occurredAt,
        ),
      ),
      refunds.map((r) =>
        Refund.create(
          UniqueEntityId.from(r.id),
          must(Money.create(r.amountMinor, row.currency), "refund amount"),
          r.occurredAt,
          r.status as RefundStatus,
          r.idempotencyKey ?? undefined,
        ),
      ),
      row.version,
      {
        provider: row.provider,
        providerTransactionRef: row.providerTransactionRef ?? undefined,
        attempts: attempts.map((a) =>
          PaymentAttempt.create(
            UniqueEntityId.from(a.id),
            a.kind as PaymentAttemptKind,
            a.outcome as PaymentAttemptOutcome,
            a.occurredAt,
            a.reference ?? undefined,
          ),
        ),
        pspReference:
          row.pspReference === null
            ? undefined
            : must(PspReference.create(row.pspReference), "psp reference"),
        paymentMethod: isSet(row.paymentMethod)
          ? must(
              PaymentMethod.create(row.paymentMethod.token, row.paymentMethod.brand),
              "payment method",
            )
          : undefined,
        authorizedAmount:
          row.authorizedAmountMinor === null
            ? undefined
            : must(Money.create(row.authorizedAmountMinor, row.currency), "authorized amount"),
      },
    );
  }

  static toIntentRow(intent: PaymentIntent, tenantId: string) {
    return {
      id: intent.id.toString(),
      tenantId,
      orderRef: intent.orderRef,
      amountMinor: intent.amount.amountMinor,
      currency: intent.amount.currency,
      status: intent.status.value,
      pspReference: intent.pspReference?.value ?? null,
      provider: intent.provider,
      providerTransactionRef: intent.providerTransactionRef ?? null,
      paymentMethod:
        intent.paymentMethod === undefined
          ? {}
          : { token: intent.paymentMethod.token, brand: intent.paymentMethod.brand },
      authorizedAmountMinor: intent.authorizedAmount?.amountMinor ?? null,
      version: 1,
    };
  }

  /** Full charge/refund history; insertion uses `skipDuplicates` (append-only, PK = entity id). */
  static toChargeRows(intent: PaymentIntent, tenantId: string) {
    return intent.charges.map((c) => ({
      id: c.id.toString(),
      tenantId,
      intentId: intent.id.toString(),
      pspToken: c.pspToken.value,
      amountMinor: c.amount.amountMinor,
      occurredAt: c.occurredAt,
    }));
  }

  static toRefundRows(intent: PaymentIntent, tenantId: string) {
    return intent.refunds.map((r) => ({
      id: r.id.toString(),
      tenantId,
      intentId: intent.id.toString(),
      amountMinor: r.amount.amountMinor,
      status: r.status,
      occurredAt: r.occurredAt,
      idempotencyKey: r.idempotencyKey ?? null,
    }));
  }

  /** Full append-only attempt log; insertion uses `skipDuplicates` (PK = entity id). */
  static toAttemptRows(intent: PaymentIntent, tenantId: string) {
    return intent.attempts.map((a) => ({
      id: a.id.toString(),
      tenantId,
      intentId: intent.id.toString(),
      kind: a.kind,
      outcome: a.outcome,
      reference: a.reference ?? null,
      occurredAt: a.occurredAt,
    }));
  }
}
