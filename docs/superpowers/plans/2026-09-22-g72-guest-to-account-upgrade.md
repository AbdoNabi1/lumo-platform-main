# G-72: Guest-to-Account Upgrade (verification-gated) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest-checkout email register a real account without an obvious fix's identity-theft hole: signup for a known email issues a single-use, hashed, tenant+customer-bound token and emails a link; only opening that link and setting a password upgrades the guest row (same customer id) to a real, login-capable account. Brand-new emails keep today's immediate registration. Signup responses for "guest" and "already has an account" are byte-identical (D2).

**Architecture:** Identity gains an `email_verified_at` column on `customers`, a new tenant-scoped `signup_tokens` table, and two use cases (`RequestSignupLink`, `CompleteSignup`) that own token issuance/verification and the guest→real upgrade — Identity never touches Security. `apps/admin`'s `CustomerAuthAdminController` (where today's `register` orchestration already lives, D5) gains `requestSignup`/`completeSignup` methods that branch on Identity's answer: brand-new → reuse existing `register()` unchanged; guest → dispatch a "complete your account" email carrying the raw token; already-registered → dispatch a "you have an account" email — both of the latter returning the identical HTTP response. A new `SignupEmailPort` (admin-owned) has exactly one adapter today, a dev adapter that logs the link, boot-guarded out of production the same way `apps/runtime/src/api.ts` already guards MFA/payments/object-storage/licensing. The storefront's existing `/account/register` flow now handles a "check your email" outcome instead of a 409, and a new `/account/signup/complete` page reads the token and sets the password.

**Tech Stack:** TypeScript, Prisma (Postgres, RLS), Fastify (via `@platform/http`), Next.js server actions (storefront), Vitest.

**Spec:** The user's G-72 task brief (this session) + `docs/architecture/23-platform-gap-register.md` row G-72 + `docs/DECISIONS.md` D1-D5 to be added.

## Global Constraints

- Migrations are **created, never applied** (`prisma migrate deploy`/`dev` must NOT be run against `.env`'s live Supabase DB) — list them in the final report.
- Additive/expand-only schema changes only (`packages/db/prisma/MIGRATIONS.md` §1-§2): nullable new column, new table, no destructive changes.
- Every new tenant-scoped table gets its OWN `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy in its migration — the existing loop-based RLS migration (`20260823000000_rls_tenant_isolation`) does NOT retroactively cover new tables (confirmed, G-63).
- No cross-context foreign keys (D-002); Identity stays unaware Security exists (ADR-0023, restated in `customer-auth.admin-controller.ts`'s doc comment).
- Token: ≥32 CSPRNG bytes raw, only a SHA-256 hash stored, 24h expiry, single-use, bound to `(tenantId, customerId)`. Reuse `node:crypto` directly (this repo's established convention — no shared crypto-utils package exists; see `NodeCrypto` in `services/security/src/infrastructure/in-memory-auth-adapters.ts`).
- D2: signup response for an existing email (guest OR already-registered) must be **status + body + headers byte-identical** regardless of which; only the dispatched email content differs. Brand-new email keeps today's `201 {customerRef}`.
- Rate limiting reuses the existing `RateLimiter` port/instance (no second implementation) with a `rl:${tenantId}:signup:${email}` key, called directly from the new route handler.
- `--no-bail` is mandatory for the full suite; never run full typecheck and full test suite at the same time; package filters use package names, not directory names; never `--no-verify`.
- Conventional Commits; commit after each task once its own tests are green.

---

## Task 1: Identity domain — `Customer.upgradeFromGuest` + `emailVerifiedAt`

**Files:**

- Modify: `services/identity/src/domain/customer.ts`
- Modify: `services/identity/src/domain/customer.test.ts` (create if absent — check first)
- Modify: `services/identity/src/infrastructure/customer.mapper.ts`
- Modify: `services/identity/src/infrastructure/prisma-customer-repository.ts` (the `save()` update branch currently only persists `name`/`version` — must add `isGuest`/`emailVerifiedAt`)
- Modify: `packages/db/prisma/schema/identity.prisma` (add `emailVerifiedAt DateTime? @map("email_verified_at")` to `Customer`)
- Create: `packages/db/prisma/schema/migrations/20260922000000_g72_customer_email_verified_at/migration.sql`

**Interfaces:**

- Produces: `Customer.emailVerifiedAt: Date | null` getter; `Customer#upgradeFromGuest(name: string, occurredAt: Date): void` — sets `isGuest = false`, `emailVerifiedAt = occurredAt`, `name = name`. Throws (`BusinessRuleError`, `@platform/utils`) if called on a non-guest customer (defensive — the use case in Task 6 never calls it on one, but the invariant should be enforced in the domain, not just trusted by the caller).
- `CustomerMapper.toDomain`/`toCustomerRow` gain `emailVerifiedAt`; `Customer.reconstitute` gains an `emailVerifiedAt: Date | null = null` parameter (after `isGuest`).

**Steps:**

- [ ] Write failing tests in `customer.test.ts`: `registerGuest().emailVerifiedAt === null`; `upgradeFromGuest` on a guest sets `isGuest === false` and `emailVerifiedAt` to the passed date and updates `name`; `upgradeFromGuest` on a non-guest (`Customer.register(...)`) throws `BusinessRuleError`.
- [ ] Run `pnpm --filter @platform/identity run test -- customer.test` — expect FAIL (method doesn't exist).
- [ ] Add `emailVerifiedAt: Date | null` to `CustomerProps`; default it to `null` in `raiseRegistered`; add the `emailVerifiedAt` getter; add `upgradeFromGuest(name, occurredAt)`:
  ```ts
  upgradeFromGuest(name: string, occurredAt: Date): void {
    if (!this.props.isGuest) {
      throw new BusinessRuleError("Only a guest customer can be upgraded");
    }
    this.props.isGuest = false;
    this.props.emailVerifiedAt = occurredAt;
    this.props.name = name;
  }
  ```
  (Note: `CustomerProps` fields are currently declared `readonly`; drop `readonly` on `isGuest`/`emailVerifiedAt`/`name` only — `addresses`/`consents` already mutate via array push despite `readonly`, so this matches the existing convention of "readonly at the type level, mutated via the aggregate's own methods only.") Update `reconstitute`'s signature to accept `emailVerifiedAt: Date | null = null` as a new final parameter.
- [ ] Run the test again — expect PASS.
- [ ] Update `identity.prisma`: add `emailVerifiedAt DateTime? @map("email_verified_at")` directly under `isGuest` on `Customer`.
- [ ] Update `CustomerMapper.toDomain` to pass `row.emailVerifiedAt` as the new `reconstitute` argument; add `emailVerifiedAt: Date | null` to `CustomerRow`. Update `toCustomerRow` to include `emailVerifiedAt: customer.emailVerifiedAt` in the insert payload.
- [ ] Update `PrismaCustomerRepository.save`'s update branch `data:` to also write `isGuest: customer.isGuest, emailVerifiedAt: customer.emailVerifiedAt` (today it only writes `name`/`version` — this is the bug that would otherwise silently drop the upgrade on persistence).
- [ ] Create the migration `packages/db/prisma/schema/migrations/20260922000000_g72_customer_email_verified_at/migration.sql`:
  ```sql
  -- G-72 — additive, expand-only (MIGRATIONS.md §1).
  --
  -- Nullable: null means "never verified" (guest or pre-verification-flow row). Set once, at
  -- CompleteSignup, alongside is_guest flipping to false. RLS is row-based and unaffected by a new
  -- column.
  ALTER TABLE "identity"."customers" ADD COLUMN "email_verified_at" TIMESTAMP(3);
  ```
- [ ] Run `pnpm --filter @platform/identity run typecheck` and `pnpm --filter @platform/identity run test` — confirm green (in-memory repo path needs no change: it stores the aggregate object itself, so any field mutation is automatically visible on the next read).
- [ ] Commit: `feat(identity): add Customer.upgradeFromGuest and email_verified_at`

## Task 2: Identity domain — `SignupToken` entity + repository port + adapters + migration

**Files:**

- Create: `services/identity/src/domain/signup-token.ts`
- Create: `services/identity/src/domain/signup-token.test.ts`
- Create: `services/identity/src/domain/signup-token-repository.ts`
- Create: `services/identity/src/infrastructure/in-memory-signup-token-repository.ts`
- Create: `services/identity/src/infrastructure/prisma-signup-token-repository.ts`
- Create: `services/identity/src/infrastructure/signup-token.mapper.ts`
- Modify: `packages/db/prisma/schema/identity.prisma` (new `SignupToken` model)
- Create: `packages/db/prisma/schema/migrations/20260922010000_g72_signup_tokens/migration.sql`

**Interfaces:**

- Produces:
  ```ts
  // domain/signup-token.ts
  export class SignupToken {
    static issue(
      id: UniqueEntityId,
      tenantId: string,
      customerId: string,
      tokenHash: string,
      expiresAt: Date,
    ): SignupToken;
    static reconstitute(
      id: UniqueEntityId,
      tenantId: string,
      customerId: string,
      tokenHash: string,
      expiresAt: Date,
      consumedAt: Date | null,
    ): SignupToken;
    get id(): UniqueEntityId;
    get tenantId(): string;
    get customerId(): string;
    get tokenHash(): string;
    get expiresAt(): Date;
    get consumedAt(): Date | null;
    isValid(now: Date): boolean; // consumedAt === null && expiresAt > now
    consume(now: Date): void; // throws BusinessRuleError if !isValid(now)
  }
  ```
  ```ts
  // domain/signup-token-repository.ts
  export interface SignupTokenRepository {
    save(token: SignupToken, tx?: unknown): Promise<void>;
    findByHash(tokenHash: string, tenantId: string, tx?: unknown): Promise<SignupToken | null>;
    /** Marks every non-consumed token for this customer as consumed (D3: issuing a new token invalidates earlier ones). Does NOT delete rows (audit trail). */
    invalidateAllForCustomer(
      customerId: string,
      tenantId: string,
      now: Date,
      tx?: unknown,
    ): Promise<void>;
  }
  ```
- Consumes: `UniqueEntityId` from `@platform/domain`, `BusinessRuleError` from `@platform/utils` (same as Task 1).

**Steps:**

- [ ] Write failing tests in `signup-token.test.ts`: `issue()` produces `consumedAt === null` and the given `expiresAt`; `isValid(now)` is `true` before expiry and unconsumed, `false` after `expiresAt`, `false` once `consume()` has run; `consume(now)` on an already-consumed or expired token throws `BusinessRuleError`; `consume(now)` on a valid token sets `consumedAt === now`.
- [ ] Run `pnpm --filter @platform/identity run test -- signup-token.test` — FAIL (module doesn't exist).
- [ ] Implement `signup-token.ts` (plain entity, no `AggregateRoot` — no domain events needed):
  ```ts
  import type { UniqueEntityId } from "@platform/domain";
  import { BusinessRuleError } from "@platform/utils";

  export class SignupToken {
    private constructor(
      private readonly _id: UniqueEntityId,
      private readonly _tenantId: string,
      private readonly _customerId: string,
      private readonly _tokenHash: string,
      private readonly _expiresAt: Date,
      private _consumedAt: Date | null,
    ) {}

    static issue(
      id: UniqueEntityId,
      tenantId: string,
      customerId: string,
      tokenHash: string,
      expiresAt: Date,
    ): SignupToken {
      return new SignupToken(id, tenantId, customerId, tokenHash, expiresAt, null);
    }

    static reconstitute(
      id: UniqueEntityId,
      tenantId: string,
      customerId: string,
      tokenHash: string,
      expiresAt: Date,
      consumedAt: Date | null,
    ): SignupToken {
      return new SignupToken(id, tenantId, customerId, tokenHash, expiresAt, consumedAt);
    }

    get id(): UniqueEntityId {
      return this._id;
    }
    get tenantId(): string {
      return this._tenantId;
    }
    get customerId(): string {
      return this._customerId;
    }
    get tokenHash(): string {
      return this._tokenHash;
    }
    get expiresAt(): Date {
      return this._expiresAt;
    }
    get consumedAt(): Date | null {
      return this._consumedAt;
    }

    isValid(now: Date): boolean {
      return this._consumedAt === null && this._expiresAt.getTime() > now.getTime();
    }

    consume(now: Date): void {
      if (!this.isValid(now)) {
        throw new BusinessRuleError(
          "Signup token is not valid (expired, already used, or unknown)",
        );
      }
      this._consumedAt = now;
    }
  }
  ```
- [ ] Run tests — PASS.
- [ ] Add `signup-token-repository.ts` per the interface above.
- [ ] Add `in-memory-signup-token-repository.ts`:
  ```ts
  export class InMemorySignupTokenRepository implements SignupTokenRepository {
    private readonly store = new Map<string, SignupToken>();
    async save(token: SignupToken): Promise<void> {
      this.store.set(token.id.toString(), token);
    }
    async findByHash(tokenHash: string, tenantId: string): Promise<SignupToken | null> {
      for (const token of this.store.values()) {
        if (token.tenantId === tenantId && token.tokenHash === tokenHash) return token;
      }
      return null;
    }
    async invalidateAllForCustomer(customerId: string, tenantId: string, now: Date): Promise<void> {
      for (const token of this.store.values()) {
        if (token.tenantId === tenantId && token.customerId === customerId && token.isValid(now)) {
          token.consume(now);
        }
      }
    }
  }
  ```
- [ ] Add `identity.prisma` model (append at end of file):
  ```prisma
  // G-72 — single-use, hashed, tenant+customer-bound signup-completion tokens. Only the SHA-256
  // hash is ever stored (D3) — the raw token exists only in memory, for the outbound email.
  model SignupToken {
    id         String    @id @db.Uuid
    tenantId   String    @map("tenant_id")
    customerId String    @map("customer_id") @db.Uuid
    tokenHash  String    @map("token_hash")
    expiresAt  DateTime  @map("expires_at")
    consumedAt DateTime? @map("consumed_at")
    createdAt  DateTime  @default(now()) @map("created_at")

    @@unique([tenantId, tokenHash])
    @@index([tenantId, customerId])
    @@map("signup_tokens")
    @@schema("identity")
  }
  ```
- [ ] Create `signup-token.mapper.ts` (mirrors `customer.mapper.ts`'s shape, mapping the Prisma row ↔ `SignupToken`).
- [ ] Create `prisma-signup-token-repository.ts`:
  - `save`: `version`-free insert-or-update — since a token row is never updated except to set `consumedAt`, use `upsert` keyed on `id` (create branch: full row; update branch: `{ consumedAt: token.consumedAt }` only) — simpler than optimistic locking since `consume()` is the only mutation and races are handled by the WHERE-guarded update below, not by a version column.
  - `findByHash`: `findFirst({ where: { tenantId, tokenHash } })`, scoped via `runReadScoped` when no `tx`, same pattern as `PrismaCustomerRepository.findByEmail`.
  - `invalidateAllForCustomer`: `updateMany({ where: { tenantId, customerId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } })` — bulk, no need to read rows first.
  - **Concurrency note for Task 6**: `CompleteSignup`'s own consume step must use a WHERE-guarded conditional update (`updateMany({ where: { id, tenantId, consumedAt: null }, data: { consumedAt: now } })`, checking `count === 1`) rather than a blind `update`, so two concurrent completions of the same token can't both succeed — add this as a distinct repository method `markConsumed(id: string, tenantId: string, now: Date, tx?: unknown): Promise<boolean>` (returns whether it won the race) instead of relying on `save()` for the consume step. Update the `SignupTokenRepository` interface and the in-memory adapter to match (in-memory: check-then-set is fine, single-threaded JS has no race there, but keep the same boolean-return contract for a uniform call site in Task 6).
- [ ] Create migration `packages/db/prisma/schema/migrations/20260922010000_g72_signup_tokens/migration.sql`:
  ```sql
  -- G-72 — additive, expand-only (MIGRATIONS.md §1). New tenant-scoped table: needs its own RLS
  -- policy explicitly (the loop-based 20260823000000_rls_tenant_isolation migration only covers
  -- tables that existed when IT ran — G-63 — it will not pick this one up).

  CREATE TABLE "identity"."signup_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_tokens_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX "signup_tokens_tenant_id_token_hash_key" ON "identity"."signup_tokens"("tenant_id", "token_hash");
  CREATE INDEX "signup_tokens_tenant_id_customer_id_idx" ON "identity"."signup_tokens"("tenant_id", "customer_id");

  ALTER TABLE "identity"."signup_tokens" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "identity"."signup_tokens" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "identity"."signup_tokens";
  CREATE POLICY tenant_isolation ON "identity"."signup_tokens" FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  ```
- [ ] Run `pnpm --filter @platform/identity run typecheck` and `test` — green.
- [ ] Commit: `feat(identity): add SignupToken entity, repository, and migration`

## Task 3: Identity infrastructure — token generation (`TokenPort`)

**Files:**

- Create: `services/identity/src/application/token-port.ts`
- Create: `services/identity/src/infrastructure/node-token-port.ts`
- Create: `services/identity/src/infrastructure/node-token-port.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface TokenPort {
    /** ≥32 CSPRNG bytes hex-encoded (D3) — the value emailed to the user. */
    generateRaw(): string;
    /** SHA-256 hex digest — the only form ever persisted (D3). */
    hash(raw: string): string;
  }
  ```

**Steps:**

- [ ] Write failing test: `generateRaw()` returns a 64-char hex string (32 bytes) and two calls differ; `hash(raw)` is deterministic (same input → same output) and is a 64-char hex string; `hash` of two different raw values differs.
- [ ] Run `pnpm --filter @platform/identity run test -- node-token-port.test` — FAIL.
- [ ] Implement:
  ```ts
  import { createHash, randomBytes } from "node:crypto";
  import type { TokenPort } from "../application/token-port";

  export class NodeTokenPort implements TokenPort {
    generateRaw(): string {
      return randomBytes(32).toString("hex");
    }
    hash(raw: string): string {
      return createHash("sha256").update(raw).digest("hex");
    }
  }
  ```
- [ ] Run test — PASS.
- [ ] Commit: `feat(identity): add TokenPort/NodeTokenPort for signup-token generation`

## Task 4: Identity application — `RequestSignupLink` use case

**Files:**

- Create: `services/identity/src/application/request-signup-link.use-case.ts`
- Create: `services/identity/src/application/request-signup-link.use-case.test.ts`

**Interfaces:**

- Consumes: `CustomerRepository.findByEmail` (Task-1-unchanged), `SignupTokenRepository.invalidateAllForCustomer`/`.save` (Task 2), `TokenPort.generateRaw`/`.hash` (Task 3), `TransactionalUnitOfWork<unknown>`, `IdGenerator`, `Clock`.
- Produces:
  ```ts
  export interface RequestSignupLinkInput {
    readonly email: string;
    readonly tenantId: string;
  }
  export type RequestSignupLinkOutput =
    | { readonly kind: "new" }
    | { readonly kind: "already-registered"; readonly customerId: string }
    | { readonly kind: "guest"; readonly customerId: string; readonly token: string; readonly expiresAt: string };
  export interface RequestSignupLinkDeps {
    readonly customers: CustomerRepository;
    readonly signupTokens: SignupTokenRepository;
    readonly tokenPort: TokenPort;
    readonly unitOfWork: TransactionalUnitOfWork<unknown>;
    readonly idGenerator: IdGenerator;
    readonly clock: Clock;
  }
  export class RequestSignupLink implements UseCase<RequestSignupLinkInput, RequestSignupLinkOutput, DomainError> { ... }
  ```
  `expiresAt` is `Date`, 24h from `clock.now()` — the class holds the TTL as a private static `24 * 60 * 60 * 1000` constant (`SIGNUP_TOKEN_TTL_MS`), not a config param (no caller needs to vary it, YAGNI).
- Produced-for: Task 6 (`CustomerController`), Task 8 (`CustomerAuthAdminController.requestSignup`).

**Steps:**

- [ ] Write failing tests (in-memory deps, deterministic `IdGenerator`/`Clock` fakes):
  - Unknown email → `{ kind: "new" }`; no token row created.
  - Existing non-guest email → `{ kind: "already-registered", customerId }`; no token row created.
  - Existing guest email → `{ kind: "guest", customerId, token, expiresAt }`; a `SignupTokenRepository` row exists whose `tokenHash === tokenPort.hash(token)` (assert the STORED value is not the raw token — this is also the "raw token never reaches the repository" acceptance test, exercised again at the HTTP layer in Task 12).
  - Calling it twice for the same guest email invalidates the first token: after the second call, `signupTokens.findByHash(hash(firstToken), tenantId)` still finds the row but `.isValid(now)` is `false` (consumed).
  - Invalid email format → validation error (`Email.create` failure surfaced as-is, same pattern as `RegisterCustomer`).
- [ ] Run `pnpm --filter @platform/identity run test -- request-signup-link` — FAIL.
- [ ] Implement, inside `unitOfWork.run`:
  ```ts
  async execute(input) {
    const email = Email.create(input.email);
    if (!email.ok) return err(email.error);
    return this.deps.unitOfWork.run(async (tx) => {
      const existing = await this.deps.customers.findByEmail(email.value.value, input.tenantId, tx);
      if (existing === null) return ok({ kind: "new" as const });
      if (!existing.isGuest) {
        return ok({ kind: "already-registered" as const, customerId: existing.id.toString() });
      }
      const now = this.deps.clock.now();
      await this.deps.signupTokens.invalidateAllForCustomer(existing.id.toString(), input.tenantId, now, tx);
      const raw = this.deps.tokenPort.generateRaw();
      const hash = this.deps.tokenPort.hash(raw);
      const expiresAt = new Date(now.getTime() + RequestSignupLink.SIGNUP_TOKEN_TTL_MS);
      const token = SignupToken.issue(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        input.tenantId,
        existing.id.toString(),
        hash,
        expiresAt,
      );
      await this.deps.signupTokens.save(token, tx);
      return ok({ kind: "guest" as const, customerId: existing.id.toString(), token: raw, expiresAt: expiresAt.toISOString() });
    });
  }
  ```
- [ ] Run tests — PASS.
- [ ] Commit: `feat(identity): add RequestSignupLink use case`

## Task 5: Identity application — `CompleteSignup` use case

**Files:**

- Create: `services/identity/src/application/complete-signup.use-case.ts`
- Create: `services/identity/src/application/complete-signup.use-case.test.ts`

**Interfaces:**

- Consumes: `CustomerRepository.findById`/`.save`, `SignupTokenRepository.findByHash`/`.markConsumed`, `TokenPort.hash`, `TransactionalUnitOfWork`, `Clock`.
- Produces:
  ```ts
  export interface CompleteSignupInput {
    readonly token: string;
    readonly name: string;
    readonly tenantId: string;
  }
  export interface CompleteSignupOutput {
    readonly customerId: string;
    readonly email: string;
  }
  export class CompleteSignup implements UseCase<CompleteSignupInput, CompleteSignupOutput, DomainError> { ... }
  ```
  Every rejection path (unknown hash, wrong tenant, expired, already-consumed, lost-the-race, orphaned customer row) returns the SAME `NotFoundError("Invalid or expired signup link")` — indistinguishable, per the brief's "expired, reused, wrong-tenant, and tampered tokens → all rejected, indistinguishably."
- Produced-for: Task 6 (`CustomerController`), Task 8 (`CustomerAuthAdminController.completeSignup`).

**Steps:**

- [ ] Write failing tests:
  - Valid, unconsumed, unexpired token for a guest customer → `ok({customerId, email})`; the customer's `isGuest` is now `false` and `emailVerifiedAt` is set (re-read via `customers.findById`); the token is now consumed (`signupTokens.findByHash(...)` → `.consumedAt !== null`).
  - Unknown token (never issued) → `err(NotFoundError)`.
  - Expired token (fake `Clock` past `expiresAt`) → `err(NotFoundError)`.
  - Already-consumed token (call `CompleteSignup.execute` twice with the same raw token) → second call `err(NotFoundError)`.
  - Wrong tenant (issue for tenant A, complete with tenant B) → `err(NotFoundError)`.
  - **Mutation check (do this now, by hand, not as a committed test):** temporarily change the implementation to skip the `signupTokens.findByHash`/validity check entirely (always proceed as if valid, deriving `customerId` some other way — or just comment out the guard) and confirm the "unknown token" / "wrong tenant" tests go RED. Revert immediately. Record this in the final report per the brief's requirement; this exercises the SAME safety property the storefront-level attack test (Task 12) checks end-to-end.
- [ ] Run `pnpm --filter @platform/identity run test -- complete-signup` — FAIL.
- [ ] Implement, inside `unitOfWork.run`:
  ```ts
  async execute(input) {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);
    return this.deps.unitOfWork.run(async (tx) => {
      const now = this.deps.clock.now();
      const hash = this.deps.tokenPort.hash(input.token);
      const record = await this.deps.signupTokens.findByHash(hash, input.tenantId, tx);
      if (record === null || !record.isValid(now)) {
        return err(new NotFoundError("Invalid or expired signup link"));
      }
      const won = await this.deps.signupTokens.markConsumed(record.id.toString(), input.tenantId, now, tx);
      if (!won) return err(new NotFoundError("Invalid or expired signup link"));

      const customer = await this.deps.customers.findById(record.customerId, input.tenantId, tx);
      if (customer === null) return err(new NotFoundError("Invalid or expired signup link"));

      customer.upgradeFromGuest(input.name, now);
      await this.deps.customers.save(customer, input.tenantId, tx);
      return ok({ customerId: customer.id.toString(), email: customer.email.value });
    });
  }
  ```
- [ ] Run tests — PASS.
- [ ] Commit: `feat(identity): add CompleteSignup use case`

## Task 6: Identity interfaces — wire into `CustomerController` + composition + exports

**Files:**

- Modify: `services/identity/src/interfaces/customer.controller.ts`
- Modify: `services/identity/src/composition.ts` (both Prisma and in-memory branches)
- Modify: `services/identity/src/index.ts`

**Interfaces:**

- Produces (on `CustomerController`):
  ```ts
  async requestSignupLink(input: RequestSignupLinkInput): Promise<ControllerResponse>; // present(..., 200)
  async completeSignup(input: CompleteSignupInput): Promise<ControllerResponse>; // present(..., 200)
  ```
- `IdentityWiringDeps` unchanged (no new required fields — `PrismaSignupTokenRepository`/`InMemorySignupTokenRepository` need only `prisma`/nothing, matching `PrismaCustomerRepository`'s existing deps shape; `NodeTokenPort` needs no deps at all, wired unconditionally in both branches).

**Steps:**

- [ ] Add `requestSignupLink: RequestSignupLink` and `completeSignup: CompleteSignup` to `CustomerControllerDeps`; add the two async methods above, each `present(await this.deps.X.execute(input), 200)` (both are reads-that-may-write, not creates — 200 fits `RequestSignupLinkOutput`'s "new"/"already-registered"/"guest" discriminant better than 201, and `CompleteSignup`'s output isn't "a new resource" the way `RegisterCustomer`'s is).
- [ ] In `composition.ts`'s `buildControllers`, construct both use cases (needs `signupTokens` repo and a `tokenPort` added to the shared `repos`/deps shape — add `signupTokens: SignupTokenRepository` to the `IdentityRepos` interface, and thread a `NodeTokenPort` instance — constructed once in `wireIdentity`, not per-branch, since it has no deps — into `buildControllers`'s new `tokenPort` parameter or folded into `deps`).
- [ ] Wire `PrismaSignupTokenRepository`/`InMemorySignupTokenRepository` in the two `wireIdentity` branches exactly like `customers` is wired today (same `{ prisma, outbox: ..., context }`-shaped deps aren't needed here since `SignupToken` raises no events — `PrismaSignupTokenRepository` only needs `{ prisma }`, `InMemorySignupTokenRepository` needs nothing).
- [ ] Export `RequestSignupLink`, `CompleteSignup`, their Input/Output/Deps types, `SignupToken`, `SignupTokenRepository`, `TokenPort`, `NodeTokenPort`, `PrismaSignupTokenRepository` from `index.ts` (mirror the existing `RegisterCustomer`/`CustomerRepository` export shape).
- [ ] Run `pnpm --filter @platform/identity run typecheck` — fix any wiring type errors.
- [ ] Run `pnpm --filter @platform/identity run test` (full package) — green.
- [ ] Commit: `feat(identity): wire RequestSignupLink/CompleteSignup into CustomerController`

## Task 7: Admin — `SignupEmailPort` + logging dev adapter

**Files:**

- Create: `apps/admin/src/interfaces/signup-email.port.ts`
- Create: `apps/admin/src/infrastructure/logging-signup-email-adapter.ts`
- Create: `apps/admin/src/infrastructure/logging-signup-email-adapter.test.ts`

**Interfaces:**

- Produces:
  ```ts
  // interfaces/signup-email.port.ts
  export interface SignupEmailPort {
    sendCompleteAccountEmail(input: {
      readonly email: string;
      readonly link: string;
      readonly tenantId: string;
    }): Promise<void>;
    sendAlreadyRegisteredEmail(input: {
      readonly email: string;
      readonly tenantId: string;
    }): Promise<void>;
  }
  ```
  ```ts
  // infrastructure/logging-signup-email-adapter.ts
  export class LoggingSignupEmailAdapter implements SignupEmailPort {
    async sendCompleteAccountEmail(input): Promise<void> {
      logger.info("signup: complete-account email (dev adapter, not actually sent)", input);
    }
    async sendAlreadyRegisteredEmail(input): Promise<void> {
      logger.info("signup: already-registered email (dev adapter, not actually sent)", input);
    }
  }
  ```
  Doc comment on the class states plainly: this is the ONLY adapter this codebase ships for `SignupEmailPort`; a real provider (Resend/SendGrid/SES) is deliberately out of scope (D4) and must be wired before `APP_ENV` leaves `local` (see `apps/runtime/src/api.ts`'s guard, Task 10) — mirrors `InMemoryTotpMfaProvider`'s doc-comment shape.

**Why not route through `services/notifications`:** checked first, per D4. Its `create → queue → send` lifecycle (the pattern `OrdersNotificationAdapter`/`PaymentsNotificationAdapter` already reuse) is a real, working channel — but its 4 provider ports (`EmailProviderPort` included) are hardcoded to permanent in-memory stubs in EVERY environment with no boot-time guard (`NotificationsWiringDeps`'s own doc comment: "out of scope for C-01") — a separate, already-tracked, still-open gap. Building this feature on top of it would silently inherit that gap rather than closing this one, and would leave nothing to guard (Notifications never lets a caller tell "real" from "stub" apart). A small dedicated port that CAN be guarded — and IS guarded, Task 10 — satisfies D4's literal ask ("must be impossible to wire in production") in a way reusing Notifications cannot today.

**Steps:**

- [ ] Write failing test: `LoggingSignupEmailAdapter` — both methods resolve without throwing (can't assert real log output cheaply; the meaningful assertions live in the e2e tests, Task 12, using a recording test double, not this class).
- [ ] Run `pnpm --filter @platform/admin run test -- logging-signup-email-adapter` — FAIL (module missing).
- [ ] Implement both files as above.
- [ ] Run test — PASS.
- [ ] Commit: `feat(admin): add SignupEmailPort and its logging dev adapter`

## Task 8: Admin — `CustomerAuthAdminController.requestSignup`/`.completeSignup`

**Files:**

- Modify: `apps/admin/src/interfaces/customer-auth.admin-controller.ts`
- Modify: `apps/admin/src/interfaces/customer-auth.admin-controller.test.ts` (check whether this file exists — if the controller is only covered by the HTTP e2e tests today, create it; otherwise extend it)

**Interfaces:**

- Consumes: `CustomerController.requestSignupLink`/`.completeSignup` (Task 6), `SignupEmailPort` (Task 7), `CustomerCredentialsPort` (unchanged, existing).
- Produces (new `CustomerAuthAdminControllerDeps` fields): `readonly signupEmail: SignupEmailPort; readonly signupCompletionUrlBase: string;` (e.g. `https://shop.example.com/account/signup/complete` — the storefront completion page's absolute URL; Task 10 wires the concrete value).
- Produces (new methods):
  ```ts
  async requestSignup(input: { email: string; name: string; password: string; tenantId: string }): Promise<AdminResponse>;
  async completeSignup(input: { token: string; name: string; password: string; tenantId: string }): Promise<AdminResponse>;
  ```

**The D2 response** — a fixed, exported constant so both branches (and the test asserting byte-identity) reference the exact same object:

```ts
const SIGNUP_LINK_SENT_RESPONSE: AdminResponse = { status: 202, body: { outcome: "link-sent" } };
```

**Steps:**

- [ ] Write failing tests (new or extended `customer-auth.admin-controller.test.ts`, using in-memory `CustomerController` from `wireIdentity({...})` with no `prisma`, a recording `SignupEmailPort` test double, and the existing `CustomerCredentialsPort`/`SecurityController` fakes already used by `register`'s tests — check that file for the exact fake shapes and reuse them):
  - `requestSignup` with a brand-new email → same effect as `register` today: `201 {customerRef}`, a `Principal` registered, a password set. No email dispatched.
  - `requestSignup` with a guest email → returns `SIGNUP_LINK_SENT_RESPONSE` exactly; NO `registerSubject`/`registerPrincipal`/`setPassword` call (assert the fakes' call counts are 0); `signupEmail.sendCompleteAccountEmail` called once with a `link` containing `signupCompletionUrlBase` and a token query param.
  - `requestSignup` with an already-registered email → returns `SIGNUP_LINK_SENT_RESPONSE` (byte-identical object/value to the guest case — assert via `toEqual`, not just status) and NO principal/credential calls; `signupEmail.sendAlreadyRegisteredEmail` called once.
  - `completeSignup` with a valid token → `201 {customerRef, email}`; `registerSubject`/`registerPrincipal`/`setPassword` ARE called (same 3-step provisioning as `register`), with the PASSWORD taken from `completeSignup`'s own input, never anything submitted earlier during `requestSignup` (there's nothing to smuggle — `requestSignup`'s password argument is provably discarded for the guest/already-registered branches: assert the earlier `requestSignup` call's password never appears anywhere `completeSignup` reads from).
  - `completeSignup` with an invalid/expired/wrong-tenant token → the response `completeSignup` returns is exactly Identity's own `404` (never re-mapped, same rule as `register`'s doc comment already states for its own status codes).
- [ ] Run `pnpm --filter @platform/admin run test -- customer-auth.admin-controller` — FAIL.
- [ ] Extract the shared step-2-4 provisioning out of `register()` into a private helper so `completeSignup` can reuse it verbatim:
  ```ts
  private async provisionCredentials(
    customerId: string,
    email: string,
    password: string,
    tenantId: string,
  ): Promise<AdminResponse | null> {
    await this.deps.credentials.registerSubject(customerId);
    const principal = await this.deps.security.registerPrincipal({
      tenantId, externalId: customerId, kind: "human", displayName: customerId, subjectRef: customerId,
    });
    if (principal.status < 200 || principal.status >= 300) return principal;
    await this.ensurePasswordMethod(tenantId);
    await this.deps.credentials.setPassword(email, password, customerId);
    return null; // null = proceed; non-null = short-circuit with this response
  }
  ```
  Rewrite `register()`'s body to call it (`const failure = await this.provisionCredentials(customerId, input.email, input.password, input.tenantId); if (failure !== null) return failure;`) — this is a pure refactor, `register()`'s own tests must stay green unmodified.
- [ ] Implement `requestSignup`:
  ```ts
  async requestSignup(input: { email: string; name: string; password: string; tenantId: string }): Promise<AdminResponse> {
    const requested = await this.deps.customers.requestSignupLink({ email: input.email, tenantId: input.tenantId });
    if (requested.status < 200 || requested.status >= 300) return requested;
    const outcome = requested.body as RequestSignupLinkOutput;

    if (outcome.kind === "new") {
      return this.register(input);
    }
    if (outcome.kind === "already-registered") {
      await this.deps.signupEmail.sendAlreadyRegisteredEmail({ email: input.email, tenantId: input.tenantId });
      return CustomerAuthAdminController.SIGNUP_LINK_SENT_RESPONSE;
    }
    const link = `${this.deps.signupCompletionUrlBase}?token=${encodeURIComponent(outcome.token)}`;
    await this.deps.signupEmail.sendCompleteAccountEmail({ email: input.email, link, tenantId: input.tenantId });
    return CustomerAuthAdminController.SIGNUP_LINK_SENT_RESPONSE;
  }
  ```
  (`RequestSignupLinkOutput` imported as a type from `@platform/identity`, Task 6's export.)
- [ ] Implement `completeSignup`:
  ```ts
  async completeSignup(input: { token: string; name: string; password: string; tenantId: string }): Promise<AdminResponse> {
    const completed = await this.deps.customers.completeSignup({ token: input.token, name: input.name, tenantId: input.tenantId });
    if (completed.status < 200 || completed.status >= 300) return completed;
    const { customerId, email } = completed.body as { customerId: string; email: string };

    const failure = await this.provisionCredentials(customerId, email, input.password, input.tenantId);
    if (failure !== null) return failure;

    return { status: 201, body: { customerRef: customerId, email } };
  }
  ```
- [ ] Run tests — PASS. Also re-run `register`'s existing tests to confirm the refactor didn't change its behavior.
- [ ] Commit: `feat(admin): add CustomerAuthAdminController.requestSignup/completeSignup`

## Task 9: Admin — composition wiring

**Files:**

- Modify: `apps/admin/src/composition.ts`

**Interfaces:**

- Produces (on `AdminWiringDeps`, additive/optional so every existing caller/test is unaffected): `readonly signupEmail?: SignupEmailPort; readonly storefrontPublicUrl?: string;`

**Steps:**

- [ ] In the block that builds `customerAuth` (around line 917 per the exploration report), add:
  ```ts
  const signupEmail: SignupEmailPort = deps.signupEmail ?? new LoggingSignupEmailAdapter();
  const signupCompletionUrlBase = `${deps.storefrontPublicUrl ?? "http://localhost:3000"}/account/signup/complete`;
  ```
  and pass `signupEmail`, `signupCompletionUrlBase` into the `CustomerAuthAdminController` constructor alongside the existing fields.
- [ ] Run `pnpm --filter @platform/admin run typecheck` — fix any fallout.
- [ ] Run `pnpm --filter @platform/admin run test` (full package — this will be slow; still faster than the full monorepo suite) — green.
- [ ] Commit: `feat(admin): wire SignupEmailPort into composition (defaults to logging adapter)`

## Task 10: Admin HTTP — routes + rate limiting

**Files:**

- Modify: `apps/admin/src/http/public-auth-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (thread `rateLimiter` through `adminRoutes`'s options)
- Modify: `apps/admin/src/http/server.ts` (pass `deps.rateLimiter` into the `adminRoutes(...)` call)
- Modify: `apps/admin/src/http/admin-http.e2e.test.ts` and any other direct `adminRoutes(...)` test call site found by `grep -rn "adminRoutes(" apps/admin/src` (currently 1 known: `financial-security-remediation.e2e.test.ts`) — an optional new field needs no change there unless that test itself exercises the new route.

**Interfaces:**

- `adminRoutes(admin: WiredAdmin, options: { readonly tenancyPinnedTo?: string; readonly rateLimiter?: RateLimiter } = {})`.
- `publicAuthRoutes(admin: WiredAdmin, rateLimiter?: RateLimiter): readonly RouteDefinition[]`.

**Steps:**

- [ ] Write a failing e2e test first (add to `apps/admin/src/http/customer-auth.e2e.test.ts` if it exists, else create it — check first): `POST /public/auth/register` (existing path, new behavior) with a brand-new email → `201 {customerRef}` (today's contract, unchanged). Run — this one should already PASS once Task 8/9 land, since the route still calls the same method name today; it will start FAILING only once this task repoints the handler — write it now as a guard-rail regardless.
- [ ] Add a second failing test: `POST /public/auth/register` with an email already used by a prior successful registration (a genuinely-registered, non-guest customer) → expect `202 {outcome: "link-sent"}`, NOT `409`. This is the one that will fail until the handler is repointed.
- [ ] Add a third failing test: `POST /public/auth/signup/complete` with `{token: "bogus", name: "A", password: "password123"}` → `404` (route doesn't exist yet — will 404 for the wrong reason; that's fine, tighten the assertion once the route exists in a follow-up run).
- [ ] Run the e2e file — confirm the new-behavior tests fail as expected.
- [ ] In `public-auth-routes.ts`: change the `/public/auth/register` route's `handle` to call `admin.customerAuth.requestSignup(...)` instead of `.register(...)` (same `registerBody` schema — no schema change). Add the rate-limit call at the top of that handler:
  ```ts
  handle: async ({ body, context }) => {
    if (rateLimiter !== undefined) {
      const decision = await rateLimiter.consume(
        `rl:${context.tenantId}:signup:${body.email.trim().toLowerCase()}`,
        5,
        60 * 60 * 1000, // 5 requests/hour per (tenant, email) — abuse-resistant without blocking a legitimate retry
      );
      if (!decision.allowed) {
        return {
          status: 429,
          body: { code: "RATE_LIMITED", message: "Too many signup requests for this email", retryable: true, fields: [], retryAfterMs: decision.retryAfterMs },
          headers: { "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))) },
        };
      }
    }
    return admin.customerAuth.requestSignup({ ...body, tenantId: context.tenantId });
  },
  ```
  (`rateLimiter !== undefined` keeps every existing unit test that builds `publicAuthRoutes(admin)` with one argument compiling and passing unchanged — the new second parameter is optional.)
- [ ] Add the `completeSignupBody` schema and the new route:
  ```ts
  const completeSignupBody = z
    .object({
      token: z.string().min(16).max(512),
      name: z.string().min(1).max(200),
      password: z.string().min(8).max(200),
    })
    .strict();
  ```
  ```ts
  defineRoute({
    method: "POST",
    path: "/public/auth/signup/complete",
    version: 1,
    permission: "identity:register_customer",
    public: true,
    idempotent: false, // consuming a single-use token is not safe to replay from cache — a retry must re-execute and get the real (now "already used") outcome, same reasoning as /login
    summary: "Public: complete a guest-to-account signup upgrade using an emailed token",
    schema: { body: completeSignupBody },
    handle: ({ body, context }) =>
      admin.customerAuth.completeSignup({ ...body, tenantId: context.tenantId }),
  }),
  ```
- [ ] Update `publicAuthRoutes`'s exported signature to `(admin: WiredAdmin, rateLimiter?: RateLimiter)`, importing `RateLimiter` from `@platform/contracts`.
- [ ] In `admin-routes.ts`: add `rateLimiter?: RateLimiter` to `adminRoutes`'s `options` parameter type; change the `...publicAuthRoutes(admin)` spread to `...publicAuthRoutes(admin, options.rateLimiter)`.
- [ ] In `server.ts`: change the `adminRoutes(admin, multi && deps.tenantId !== undefined ? {...} : {})` call to include `rateLimiter: deps.rateLimiter` in both branches of that ternary's object.
- [ ] Re-run the e2e file — all three tests now pass as specified. Also re-run `/public/auth/login` and every other existing `public-auth-routes` e2e test in the suite to confirm no regression.
- [ ] Run `pnpm --filter @platform/admin run typecheck` and `pnpm --filter @platform/admin run test` — green.
- [ ] Commit: `feat(admin): repoint /public/auth/register through requestSignup and add /signup/complete`

## Task 11: Runtime — production guard + config

**Files:**

- Modify: `apps/runtime/src/api.ts`
- Modify: `apps/runtime/src/config.ts` (add `STOREFRONT_PUBLIC_URL`)
- Modify: `apps/runtime/src/composition.ts` (pass `storefrontPublicUrl` through to `AdminWiringDeps`; no `signupEmail` override — none exists, per D4, "leave the port ready for it")

**Steps:**

- [ ] Add to `config.ts`'s schema: `STOREFRONT_PUBLIC_URL: z.string().url().optional()` (near the other `*_URL` optional fields), with a comment noting it defaults to `http://localhost:3000` in `wireAdmin`/`apps/admin/src/composition.ts` when absent — matches the pattern of `RUNTIME_API_URL`'s default on the storefront side.
- [ ] Write a failing test for the new guard in `apps/runtime/src/api.test.ts` (check whether this file exists — the 5 existing guards are almost certainly tested there already; follow its exact pattern): `assertProductionSignupEmailConfigured("local", new LoggingSignupEmailAdapter())` does not throw (warns); `assertProductionSignupEmailConfigured("production", new LoggingSignupEmailAdapter())` throws; `assertProductionSignupEmailConfigured("production", someOtherObjectImplementingThePort)` does not throw.
- [ ] Run the test file — FAIL (function doesn't exist).
- [ ] Add the guard to `api.ts`, immediately after `assertProductionObjectStorageConfigured`, matching its exact shape:
  ```ts
  export function assertProductionSignupEmailConfigured(
    appEnv: RuntimeConfig["APP_ENV"],
    signupEmail: SignupEmailPort,
  ): void {
    if (!(signupEmail instanceof LoggingSignupEmailAdapter)) return;
    if (appEnv === "local") {
      logger.warn(
        "Signup verification email is permissive: no production SignupEmailPort configured, APP_ENV=local",
      );
    } else {
      throw new Error(
        "api: no production SignupEmailPort is configured (G-72). The logging dev adapter (writes " +
          "the signup-completion link to the log instead of emailing it) must never back account " +
          "verification outside APP_ENV=local. Pass signupEmail in createAdminHttpApi's deps once a " +
          "real provider (Resend/SendGrid/SES/...) is chosen and wired.",
      );
    }
  }
  ```
  Import `SignupEmailPort`/`LoggingSignupEmailAdapter` from `@platform/admin` (check the package's actual export path used for other admin-owned infra the runtime imports, e.g. how `createAdminHttpApi` itself is imported — mirror that).
- [ ] Add `collectGuardFailure(() => assertProductionSignupEmailConfigured(config.APP_ENV, runtime.signupEmail))` to the `guardFailures` array in `startApi` — this requires `RuntimeCore` (in `composition.ts`) to expose a resolved `signupEmail: SignupEmailPort` field (default `new LoggingSignupEmailAdapter()`, same "always resolve to SOMETHING, guard checks instanceof" shape as `mfaProviders`/`objectStorage`).
- [ ] Add `storefrontPublicUrl: config.STOREFRONT_PUBLIC_URL` to the `createAdminHttpApi({...})` call's spread in `startApi`.
- [ ] Run the guard test — PASS.
- [ ] Run `pnpm --filter @platform/runtime run typecheck` and `test` — green.
- [ ] Commit: `feat(runtime): guard SignupEmailPort out of production, add STOREFRONT_PUBLIC_URL`

## Task 12: Storefront — actions, pages, messages

**Files:**

- Modify: `apps/storefront/src/lib/runtime-api.ts`
- Modify: `apps/storefront/src/app/account/actions.ts`
- Modify: `apps/storefront/src/app/account/actions.test.ts` (extend)
- Modify: `apps/storefront/src/components/auth-form.tsx`
- Create: `apps/storefront/src/app/account/signup/complete/page.tsx`
- Create: `apps/storefront/src/components/signup-complete-form.tsx`
- Modify: `apps/storefront/src/messages/en.ts`
- Modify: `apps/storefront/src/messages/ar.ts`

**Steps:**

- [ ] In `runtime-api.ts`: change `registerCustomer`'s return type to reflect the new possible `202` (still POSTs the same body to the same URL — no change to the request side):
  ```ts
  export function registerCustomer(
    email: string, name: string, password: string, idempotencyKey: string,
  ): Promise<{ readonly status: number; readonly body: { readonly customerRef: string } | { readonly outcome: "link-sent" } | null }> {
    return postItem(...) // unchanged call, only the declared type widens
  }
  ```
  Add `completeSignup(token: string, name: string, password: string, idempotencyKey: string)`:
  ```ts
  export function completeSignup(
    token: string,
    name: string,
    password: string,
    idempotencyKey: string,
  ): Promise<{
    readonly status: number;
    readonly body: { readonly customerRef: string; readonly email: string } | null;
  }> {
    return postItem(
      "/api/v1/public/auth/signup/complete",
      { token, name, password },
      { "Idempotency-Key": idempotencyKey },
    );
  }
  ```
- [ ] Write failing tests in `actions.test.ts` for the new `registerAccount` behavior and a new `completeAccountSignup` action (check the existing test file's mocking pattern for `runtime-api` first and follow it exactly):
  - `registerAccount` when the mocked `registerCustomer` returns `201 {customerRef}` → still signs in and returns `{ok: true}` — unchanged regression coverage.
  - `registerAccount` when the mock returns `202 {outcome: "link-sent"}` → returns a NEW result variant, `{ok: true, checkEmail: true}` (does NOT call `signIn`).
  - `completeAccountSignup(token, name, password)` when the mock returns `201 {customerRef, email}` → calls `signIn(email, password)` and returns its result.
  - `completeAccountSignup` when the mock returns `404` → returns `{ok: false, reason: "invalid-token"}` (a NEW reason value — this is the one case that must NOT collapse into the existing generic `network`/`validation` reasons, since the storefront needs distinct copy for "this link doesn't work anymore").
- [ ] Run `pnpm --filter @platform/storefront run test -- actions.test` — FAIL.
- [ ] Implement in `actions.ts`:
  - Widen `AuthActionResult` (or add a sibling type `RegisterActionResult`) to include the `checkEmail` case; update `registerAccount` to branch on `registered.status === 202` (return `{ok: true, checkEmail: true}`) vs `< 300` (proceed to `signIn` exactly as today) vs failure (`mapAuthFailure`, unchanged — `409` no longer occurs from this route in practice, but leave the mapping in place, it's harmless dead code for a status that won't arrive rather than a foot-gun to remove and re-add later).
  - Add `mapCompleteSignupFailure(status)`: `404 → "invalid-token"`, else reuse `mapAuthFailure`'s other branches (extract a shared helper or just duplicate the two extra lines — duplication is fine here, it's 2 lines and the sets of possible statuses genuinely differ).
  - Add `completeAccountSignup(token: string, name: string, password: string)`.
- [ ] Run tests — PASS.
- [ ] Update `AuthForm`'s `onSubmit` (register mode only) to branch on `result.checkEmail`: show `t.account.signup.checkEmailTitle`/`checkEmailBody` copy instead of redirecting — smallest change: an added local state `checkEmailSent: boolean`, set on that branch, gating a short early return in the render (a `{checkEmailSent ? <CheckEmailNotice/> : <form>...</form>}` swap) rather than a route change, since the user is already on the right page.
- [ ] Create `signup-complete-form.tsx` (client component, mirrors `AuthForm`'s register-mode shape but with only `name`+`password` fields, taking `token: string` as a prop, calling `completeAccountSignup(token, name, password)`, showing `t.account.signup.completeError` styled the same as `AuthForm`'s error `<p role="alert">`, and on success `router.push("/account"); router.refresh();` exactly like `AuthForm`).
- [ ] Create `apps/storefront/src/app/account/signup/complete/page.tsx` (Server Component, mirrors `account/register/page.tsx`'s shell: same already-signed-in redirect, same `SiteHeader`/back-link/`Card` chrome), reading `token` from `searchParams` (Next.js App Router: `{ searchParams }: { searchParams: Promise<{ token?: string }> }`, per this Next version's async-searchParams convention — confirm the exact convention by checking a sibling page that already reads search params, if one exists, before assuming; if none does, check the Next.js version in `apps/storefront/package.json` and use that version's documented shape) and passing it to `<SignupCompleteForm token={token} t={t} />`; if `token` is absent/empty, render an inline "this link is invalid" message instead of the form — never pass an empty string through to the action.
- [ ] **Token never leaks (brief requirement):** confirm (already established in exploration — no analytics/tracking exists in storefront) there is nothing to suppress; add a one-line comment on the page noting the token is read server-side from `searchParams` and handed only to the Server Action, never rendered into a client-visible `<a href>`/logged/put in a form's GET method (the form posts via the Server Action, not a `<form method="get">`).
- [ ] Add to both `en.ts` and `ar.ts`, under `account`, a new `signup` key sibling to `register`/`signIn`/`signOut`/`errors`:
  ```ts
  signup: {
    checkEmailTitle: "Check your email",
    checkEmailBody: "If that email can be used, we've sent a link to finish setting up your account.",
    completeTitle: "Finish creating your account",
    completeSubtitle: "Set a password to complete your account.",
    nameLabel: "Name",
    passwordLabel: "Password",
    passwordHint: "At least 8 characters.",
    submit: "Complete account",
    submitting: "Completing…",
    invalidLink: "This link is invalid or has expired. Request a new one from the sign-up page.",
  },
  ```
  and add `invalidToken: "This link is invalid or has expired."` under `account.errors` (parallel to `credentials`/`conflict`/etc.) — Arabic mirror with equivalent meaning, matching the existing `ar.ts` tone/register used for `account.register.*`.
- [ ] Run `pnpm --filter @platform/storefront run typecheck` and `pnpm --filter @platform/storefront run test` — green.
- [ ] Commit: `feat(storefront): handle check-email signup outcome and add completion page`

## Task 13: End-to-end attack test + D2 identical-response assertion + mutation check

**Files:**

- Modify: `apps/admin/src/http/customer-auth.e2e.test.ts` (the file created/extended in Task 10)

**Steps:**

- [ ] Write the attack test exactly as specified in the brief, against the full HTTP stack (real `createAdminHttpApi`-style wiring, in-memory persistence, real routes):
  1. Simulate a guest checkout creating a guest customer row for `victim@example.com` (call `admin.customers.resolveGuestCustomer` directly, the same way `ResolveGuestCustomer`'s own tests do — or through whatever checkout path the existing e2e suite already uses to create a guest row; check `apps/admin/src/http/*.e2e.test.ts` for an existing guest-checkout-setup helper before writing a new one).
  2. `POST /public/auth/register` with `victim@example.com` + attacker-chosen name/password → expect `202 {outcome: "link-sent"}` (the D2 response — confirm no 201, no customerRef).
  3. Attacker never opens the emailed link (nothing further happens with the token).
  4. `POST /public/auth/login` with `victim@example.com` + the attacker's chosen password → expect `401` (the shared "failed login" response, per rule 1 in the controller's own doc comment) — login must fail.
  5. `GET /public/auth/me` with no session (or a bogus session header) → expect `401`.
  6. If the e2e suite has a way to check customer-history routes (orders/wishlist/loyalty) — check for one; if found, hit it unauthenticated too and expect `401`, extending the assertion; if none exists in this suite, the login+me assertions above are sufficient and this sub-step is skipped, noted in the report.
- [ ] Write the D2 identical-response test: register `guest2@example.com` as a guest (as above) and, separately, fully register+verify `verified@example.com` through the complete flow (guest → link → complete) so it's a genuine already-registered account; then `POST /public/auth/register` for both emails and assert the two HTTP responses are deep-equal on status, body, AND every response header except any inherently-varying one (e.g. `date`/`x-request-id` if present — check actual headers returned by the test client and list exactly which are excluded, don't hand-wave it).
- [ ] Write the "one email captured by a fake port" test: wire a recording `SignupEmailPort` test double into this e2e app's composition; after the guest-email registration call, assert exactly one call was recorded, on `sendCompleteAccountEmail`, whose `link` contains a `token=` query parameter; assert `sendCompleteAccountEmail`/`sendAlreadyRegisteredEmail` were the ONLY methods called (no double-send).
- [ ] Write the "raw token never reaches the repository" test at the HTTP layer (Task 4 already covers it at the use-case layer — this one confirms it end-to-end): extract the token from the recorded email's `link`, then reach into the same in-memory `SignupTokenRepository` instance the test's composition used and confirm no stored row's `tokenHash` equals the raw token string.
- [ ] Write the "brand-new email still registers immediately" regression test (if Task 10 didn't already add an equivalent — check first, don't duplicate): `POST /public/auth/register` with a never-seen email → `201 {customerRef}`, then `POST /public/auth/login` with that email/password → `200` with a session.
- [ ] Run the full file — all new tests pass.
- [ ] **Mutation-check the attack test**, per the brief: temporarily edit `CompleteSignup`'s implementation (Task 5) to skip the token-validity check — e.g. change `if (record === null || !record.isValid(now))` to `if (record === null)` (so an unconsumed-but-expired-or-consumed token would still be accepted) — that's not quite the right mutation for THIS test (the attack test never calls `/signup/complete` at all, it only checks that skipping verification is impossible via `/login` directly). Re-read the attack test: it proves login fails without completion. The mutation that should turn it red is one that makes `requestSignup` upgrade the guest row WITHOUT verification — temporarily change `requestSignup`'s `"guest"` branch (Task 8) to call `this.provisionCredentials(...)` immediately instead of emailing a link, and confirm the attack test's step 4 (`login` expecting `401`) now gets `200` instead — i.e., goes RED. Revert the temporary change immediately after confirming. Record the exact one-line mutation and the before/after result in the final report.
- [ ] Run `pnpm --filter @platform/admin run test` (full package, `--no-bail` not needed for a single package run but harmless) — green.
- [ ] Commit: `test(admin): add G-72 attack test, D2 identical-response, and email-capture coverage`

## Task 14: `check-outbox-tenant.mjs` + `pnpm arch` + full monorepo gates

**Steps:**

- [ ] Run `node scripts/dev/check-outbox-tenant.mjs` — since `SignupToken` raises no domain events (Task 2's deliberate choice), it should have nothing to flag for this feature; confirm the script passes and re-read its output for anything about `identity.customers`' new column (it shouldn't care about non-outbox columns, but verify).
- [ ] Run `pnpm arch` — confirms no forbidden cross-context imports were introduced (e.g. Identity importing from `apps/admin`, or `apps/admin` importing `services/notifications` internals directly instead of through its public `index.ts`).
- [ ] Run `pnpm -r --workspace-concurrency=4 run typecheck` (full monorepo, NOT combined with the full test run in the same go, per the constraint) — fix any cross-package fallout (e.g. any other file that imported `CustomerAuthAdminControllerDeps` and needs the two new required fields, or `reconstitute`'s widened signature).
- [ ] Run `pnpm -r --workspace-concurrency=4 --no-bail run test` (full monorepo) — review every failure; fix regressions this change caused; a pre-existing unrelated failure is out of scope but must be confirmed pre-existing (re-run it in isolation) before being ignored, and noted in the report.
- [ ] Fix anything the two full-repo runs surfaced; re-run the specific affected package(s) with `pnpm --filter <name> run typecheck|test` to confirm before re-running the full suite again if needed.

## Task 15: Docs — close G-72, add decisions

**Files:**

- Modify: `docs/architecture/23-platform-gap-register.md`
- Modify: `docs/DECISIONS.md`

**Steps:**

- [ ] Rewrite the G-72 row (line ~130) to the closed format, mirroring G-70's exact cell shape:
  - Cell 2: `**Closed 2026-09-22 — verification-gated upgrade ships: a guest email can now become a real account only by proving ownership of it.** ...` followed by a dense evidence narrative — what shipped (new `signup_tokens` table + `email_verified_at` column, `RequestSignupLink`/`CompleteSignup` use cases, `requestSignup`/`completeSignup` on `CustomerAuthAdminController`, `/public/auth/register` now branches instead of 409ing on a guest email, new `/public/auth/signup/complete` route, `SignupEmailPort` + guarded logging dev adapter, storefront check-email + completion pages) — with exact file:line references for the load-bearing ones (the token-validity check in `CompleteSignup`, the D2 response constant in `CustomerAuthAdminController`).
  - Cell 3: `Closed. Regression: <list every new/extended test file from Tasks 1-13, one clause each naming what it proves>.`
  - Cell 4: `—`.
- [ ] Add `docs/DECISIONS.md` entries `### D-057` (D1: verification-gated upgrade — decision/reason/trade-offs, referencing G-72) and `### D-058` (D2: no-purchase-oracle identical response — decision/reason/trade-offs), in the exact three-bullet format of the existing entries (check the current last entry number first — it may have advanced past D-056 since the exploration pass; use whatever is actually next).
- [ ] Commit: `docs: close G-72 and record D1/D2 decisions`

## Task 16: Final verification, report, push

**Steps:**

- [ ] Re-run the full command sequence from Task 14 one more time from a clean state to confirm nothing regressed from the docs-only commit.
- [ ] Confirm `git status` is clean except intentional changes; review the full diff once for anything unintended (e.g. accidental formatting-only changes from an editor, or a stray console.log).
- [ ] `git push origin morbeh/w0-w17-w12` (the existing branch — no new branch, per the brief).
- [ ] Compose the final report per the brief's "Report back" section: what `services/notifications` offered and why it wasn't used (Task 7's rationale); how the dev adapter is refused in production (Task 11's guard, quoted); the attack test and its mutation check (Task 13, with the exact mutation and before/after result); the D2 identical-response assertion (Task 13); the migrations to deploy (both files from Tasks 1 and 2, full paths); gate results (Task 14); push result; anything encountered that contradicts this plan or the brief.
