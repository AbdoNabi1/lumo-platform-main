import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import {
  ReturnAttempt,
  type ReturnAttemptKind,
  type ReturnAttemptOutcome,
} from "../domain/return-attempt";
import { ReturnInspection } from "../domain/return-inspection";
import { ReturnItem } from "../domain/value-objects/return-item";
import { ReturnRequest } from "../domain/return-request";
import { RefundDecision, type ResolutionOutcome } from "../domain/value-objects/refund-decision";
import { ReturnApproval } from "../domain/value-objects/return-approval";
import { ReturnDisposition } from "../domain/value-objects/return-disposition";
import { ReturnReason } from "../domain/value-objects/return-reason";
import { ReturnStatus, type ReturnStatusValue } from "../domain/value-objects/return-status";

export interface ReturnItemJson {
  readonly orderItemRef: string;
  readonly productRef: string;
  readonly quantity: number;
  readonly reason: { readonly code: string; readonly note?: string };
  readonly disposition?: string;
}
export interface ReturnApprovalJson {
  readonly approved: boolean;
  readonly note?: string;
  readonly decidedAt: string;
}
export interface ReturnInspectionJson {
  readonly id: string;
  readonly itemRef: string;
  readonly passed: boolean;
  readonly note?: string;
  readonly occurredAt: string;
}
export interface RefundDecisionJson {
  readonly outcome: ResolutionOutcome;
  readonly amountMinor?: number;
  readonly currency?: string;
}

export interface ReturnRequestRow {
  readonly id: string;
  readonly orderRef: string;
  readonly items: readonly ReturnItemJson[];
  readonly status: string;
  readonly approval: ReturnApprovalJson | Record<string, never>;
  readonly rmaNumber: string | null;
  readonly inspections: readonly ReturnInspectionJson[];
  readonly refundDecision: RefundDecisionJson | Record<string, never>;
  readonly version: number;
}
export interface AttemptRow {
  readonly id: string;
  readonly kind: string;
  readonly outcome: string;
  readonly reference: string | null;
  readonly occurredAt: Date;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt return row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

function isSet<T extends object>(value: T | Record<string, never>): value is T {
  return Object.keys(value).length > 0;
}

/** Persistence ↔ aggregate mapping for {@link ReturnRequest}. Mapping only — no I/O. */
export class ReturnRequestMapper {
  static toDomain(row: ReturnRequestRow, attempts: readonly AttemptRow[] = []): ReturnRequest {
    return ReturnRequest.reconstitute(
      UniqueEntityId.from(row.id),
      row.orderRef,
      row.items.map((itemJson) =>
        ReturnItem.create(
          UniqueEntityId.from(itemJson.orderItemRef),
          itemJson.orderItemRef,
          must(ProductRef.create(itemJson.productRef), "item productRef"),
          itemJson.quantity,
          must(ReturnReason.create(itemJson.reason.code, itemJson.reason.note), "return reason"),
          itemJson.disposition === undefined
            ? undefined
            : must(ReturnDisposition.create(itemJson.disposition), "return disposition"),
        ),
      ),
      ReturnStatus.from(row.status as ReturnStatusValue),
      row.version,
      {
        attempts: attempts.map((a) =>
          ReturnAttempt.create(
            UniqueEntityId.from(a.id),
            a.kind as ReturnAttemptKind,
            a.outcome as ReturnAttemptOutcome,
            a.occurredAt,
            a.reference ?? undefined,
          ),
        ),
        inspections: row.inspections.map((i) =>
          ReturnInspection.create(
            UniqueEntityId.from(i.id),
            i.itemRef,
            i.passed,
            new Date(i.occurredAt),
            i.note,
          ),
        ),
        approval: isSet(row.approval)
          ? row.approval.approved
            ? ReturnApproval.approve(new Date(row.approval.decidedAt), row.approval.note)
            : ReturnApproval.reject(new Date(row.approval.decidedAt), row.approval.note)
          : undefined,
        rmaNumber: row.rmaNumber ?? undefined,
        refundDecision: isSet(row.refundDecision)
          ? must(
              RefundDecision.create(
                row.refundDecision.outcome,
                row.refundDecision.amountMinor,
                row.refundDecision.currency,
              ),
              "refund decision",
            )
          : undefined,
      },
    );
  }

  static toRow(returnRequest: ReturnRequest, tenantId: string) {
    return {
      id: returnRequest.id.toString(),
      tenantId,
      orderRef: returnRequest.orderRef,
      items: returnRequest.items.map((item) => ({
        orderItemRef: item.orderItemRef,
        productRef: item.productRef.value,
        quantity: item.quantity,
        reason: { code: item.reason.code, note: item.reason.note },
        disposition: item.disposition?.value,
      })),
      status: returnRequest.status.value,
      approval:
        returnRequest.approval === undefined
          ? {}
          : {
              approved: returnRequest.approval.approved,
              note: returnRequest.approval.note,
              decidedAt: returnRequest.approval.decidedAt.toISOString(),
            },
      rmaNumber: returnRequest.rmaNumber ?? null,
      inspections: returnRequest.inspections.map((i) => ({
        id: i.id.toString(),
        itemRef: i.itemRef,
        passed: i.passed,
        note: i.note,
        occurredAt: i.occurredAt.toISOString(),
      })),
      refundDecision:
        returnRequest.refundDecision === undefined
          ? {}
          : {
              outcome: returnRequest.refundDecision.outcome,
              amountMinor: returnRequest.refundDecision.amountMinor,
              currency: returnRequest.refundDecision.currency,
            },
      version: 1,
    };
  }

  /** Full append-only attempt log; insertion uses `skipDuplicates` (PK = entity id). */
  static toAttemptRows(returnRequest: ReturnRequest, tenantId: string) {
    return returnRequest.attempts.map((a) => ({
      id: a.id.toString(),
      tenantId,
      returnId: returnRequest.id.toString(),
      kind: a.kind,
      outcome: a.outcome,
      reference: a.reference ?? null,
      occurredAt: a.occurredAt,
    }));
  }
}
