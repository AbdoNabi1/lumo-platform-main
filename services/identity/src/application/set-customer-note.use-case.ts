import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import { normalizeNote, type CustomerAnnotationRepository } from "../domain/customer-annotations";

export interface SetCustomerNoteInput {
  readonly tenantId: string;
  readonly customerId: string;
  readonly note: string | null;
}

export interface SetCustomerNoteOutput {
  readonly customerId: string;
  readonly note: string | null;
}

export interface SetCustomerNoteDeps {
  readonly annotations: CustomerAnnotationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Sets or clears a customer's staff note (blank → none). Never bumps the customer's version. */
export class SetCustomerNote implements UseCase<
  SetCustomerNoteInput,
  SetCustomerNoteOutput,
  DomainError
> {
  private readonly deps: SetCustomerNoteDeps;

  constructor(deps: SetCustomerNoteDeps) {
    this.deps = deps;
  }

  async execute(input: SetCustomerNoteInput): Promise<Result<SetCustomerNoteOutput, DomainError>> {
    if (input.note !== null && typeof input.note !== "string") {
      return err(
        new ValidationError("Invalid note", [{ field: "note", message: "must be a string" }]),
      );
    }
    const note = normalizeNote(input.note);
    if (!note.ok) return err(note.error);

    return this.deps.unitOfWork.run<Result<SetCustomerNoteOutput, DomainError>>(async (tx) => {
      const stored = await this.deps.annotations.setNote(
        input.customerId,
        note.value,
        input.tenantId,
        tx,
      );
      if (!stored) return err(new NotFoundError("Customer not found"));
      return ok({ customerId: input.customerId, note: note.value });
    });
  }
}
