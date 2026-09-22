import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { SignupToken } from "../domain/signup-token";
import type { SignupTokenRepository } from "../domain/signup-token-repository";
import { SignupTokenMapper } from "./signup-token.mapper";

export interface PrismaSignupTokenRepositoryDeps {
  readonly prisma: Database;
}

/**
 * Production `SignupTokenRepository` on the `identity` schema (G-72). Unlike `PrismaCustomerRepository`
 * this needs no optimistic-locking `version` column: a token row is written once (`save`) and then
 * mutated in exactly one way (`consumedAt`, via `markConsumed`'s WHERE-guarded conditional update),
 * so the guarded update itself is the concurrency control.
 */
export class PrismaSignupTokenRepository implements SignupTokenRepository {
  private readonly deps: PrismaSignupTokenRepositoryDeps;

  constructor(deps: PrismaSignupTokenRepositoryDeps) {
    this.deps = deps;
  }

  async save(token: SignupToken, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    await client.signupToken.create({ data: SignupTokenMapper.toRow(token) });
  }

  async findByHash(tokenHash: string, tenantId: string, tx?: unknown): Promise<SignupToken | null> {
    const run = (client: TransactionClient) =>
      client.signupToken.findFirst({ where: { tenantId, tokenHash } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SignupTokenMapper.toDomain(row);
  }

  async invalidateAllForCustomer(
    customerId: string,
    tenantId: string,
    now: Date,
    tx?: unknown,
  ): Promise<void> {
    const client = this.requireTx(tx);
    await client.signupToken.updateMany({
      where: { tenantId, customerId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
  }

  async markConsumed(id: string, tenantId: string, now: Date, tx?: unknown): Promise<boolean> {
    const client = this.requireTx(tx);
    const updated = await client.signupToken.updateMany({
      where: { id, tenantId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return updated.count === 1;
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaSignupTokenRepository's write methods require the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
