import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError, NotFoundError } from "@platform/utils";
import type { StaffDirectoryRepository } from "../domain/repositories";
import {
  normaliseEmail,
  StaffDirectoryEntry,
  type StaffDirectoryEntryInput,
  type StaffDirectoryEntryView,
} from "../domain/staff-directory";

export interface StaffDirectoryDeps {
  readonly staffDirectory: StaffDirectoryRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

export function toStaffDirectoryEntryView(entry: StaffDirectoryEntry): StaffDirectoryEntryView {
  return {
    email: entry.email,
    shopId: entry.shopId,
    ownerExternalId: entry.ownerExternalId,
    status: entry.status,
  };
}

/** Records that `email` signs in to `shopId`, as `pending` until sign-up completes. One store per email. */
export class RecordPendingOwner implements UseCase<
  StaffDirectoryEntryInput,
  StaffDirectoryEntryView,
  DomainError
> {
  private readonly deps: StaffDirectoryDeps;

  constructor(deps: StaffDirectoryDeps) {
    this.deps = deps;
  }

  async execute(
    input: StaffDirectoryEntryInput,
  ): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    const entry = StaffDirectoryEntry.create(input);
    if (!entry.ok) return err(entry.error);
    return this.deps.unitOfWork.run<Result<StaffDirectoryEntryView, DomainError>>(async (tx) => {
      const existing = await this.deps.staffDirectory.findByEmail(entry.value.email, tx);
      if (existing !== null) return err(new ConflictError("Email already has a store"));
      try {
        // `create` is the race-proof guard; the pre-check above only gives the common-case answer.
        await this.deps.staffDirectory.create(entry.value, tx);
      } catch (error) {
        if (error instanceof ConflictError) return err(error);
        throw error;
      }
      return ok(toStaffDirectoryEntryView(entry.value));
    });
  }
}

/** Marks a pending entry active. Idempotent: an active entry is returned unchanged. */
export class ActivateDirectoryEntry implements UseCase<
  { readonly email: string },
  StaffDirectoryEntryView,
  DomainError
> {
  private readonly deps: StaffDirectoryDeps;

  constructor(deps: StaffDirectoryDeps) {
    this.deps = deps;
  }

  async execute(input: {
    readonly email: string;
  }): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    return this.deps.unitOfWork.run<Result<StaffDirectoryEntryView, DomainError>>(async (tx) => {
      const entry = await this.deps.staffDirectory.findByEmail(normaliseEmail(input.email), tx);
      if (entry === null) return err(new NotFoundError("No store is registered for this email"));
      if (entry.status === "active") return ok(toStaffDirectoryEntryView(entry));
      const activated = entry.activate();
      await this.deps.staffDirectory.save(activated, tx);
      return ok(toStaffDirectoryEntryView(activated));
    });
  }
}

export interface ReserveStaffEmailInput extends StaffDirectoryEntryInput {
  /**
   * A leftover row of THIS shop held for another owner (a release that failed earlier) is taken
   * over instead of refused. A row of another shop is never touched.
   */
  readonly replaceSameShop?: boolean;
}

/**
 * Wave 1d: reserves `email` for `shopId` while a teammate is invited. The row is inserted `active`
 * (no credential exists until the invitation is accepted, so merchant sign-in still answers 401 and
 * a merchant reset sends nothing). Everything is compared and written in ONE tenancy UoW; `create`
 * stays the race-proof guard. A row of another shop is a `ConflictError`.
 */
export class ReserveStaffEmail implements UseCase<
  ReserveStaffEmailInput,
  StaffDirectoryEntryView,
  DomainError
> {
  private readonly deps: StaffDirectoryDeps;

  constructor(deps: StaffDirectoryDeps) {
    this.deps = deps;
  }

  async execute(
    input: ReserveStaffEmailInput,
  ): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    const wanted = StaffDirectoryEntry.createActive(input);
    if (!wanted.ok) return err(wanted.error);
    const row = wanted.value;
    return this.deps.unitOfWork.run<Result<StaffDirectoryEntryView, DomainError>>(async (tx) => {
      // Two passes: a lost insert race re-reads once, so the loser is judged against the winner's row.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const existing = await this.deps.staffDirectory.findByEmail(row.email, tx);
        if (existing === null) {
          try {
            await this.deps.staffDirectory.create(row, tx);
            return ok(toStaffDirectoryEntryView(row));
          } catch (error) {
            if (error instanceof ConflictError && attempt === 0) continue;
            if (error instanceof ConflictError) return err(error);
            throw error;
          }
        }
        if (existing.shopId !== row.shopId) {
          return err(new ConflictError("Email already has a store"));
        }
        if (existing.ownerExternalId === row.ownerExternalId) {
          return ok(toStaffDirectoryEntryView(existing));
        }
        if (input.replaceSameShop !== true) {
          return err(new ConflictError("Email already has a store"));
        }
        const replaced = existing.withOwner(row.ownerExternalId);
        await this.deps.staffDirectory.save(replaced, tx);
        return ok(toStaffDirectoryEntryView(replaced));
      }
      return err(new ConflictError("Email already has a store"));
    });
  }
}

/** Wave 1d: removes the reservation only when email, shop and owner all match; anything else is a no-op. */
export class ReleaseStaffEmail implements UseCase<
  StaffDirectoryEntryInput,
  { readonly released: boolean },
  DomainError
> {
  private readonly deps: StaffDirectoryDeps;

  constructor(deps: StaffDirectoryDeps) {
    this.deps = deps;
  }

  async execute(
    input: StaffDirectoryEntryInput,
  ): Promise<Result<{ readonly released: boolean }, DomainError>> {
    const target = StaffDirectoryEntry.create(input);
    if (!target.ok) return ok({ released: false });
    return this.deps.unitOfWork.run<Result<{ readonly released: boolean }, DomainError>>(
      async (tx) => {
        const existing = await this.deps.staffDirectory.findByEmail(target.value.email, tx);
        if (
          existing === null ||
          existing.shopId !== target.value.shopId ||
          existing.ownerExternalId !== target.value.ownerExternalId
        ) {
          return ok({ released: false });
        }
        const released = await this.deps.staffDirectory.delete(existing, tx);
        return ok({ released });
      },
    );
  }
}

export class FindStaffDirectoryEntry {
  private readonly deps: Pick<StaffDirectoryDeps, "staffDirectory">;

  constructor(deps: Pick<StaffDirectoryDeps, "staffDirectory">) {
    this.deps = deps;
  }

  async execute(email: string): Promise<StaffDirectoryEntryView | null> {
    const entry = await this.deps.staffDirectory.findByEmail(normaliseEmail(email));
    return entry === null ? null : toStaffDirectoryEntryView(entry);
  }
}
