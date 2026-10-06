# Durable Password Credentials (Plan 1B-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):**
>
> **المشكلة:** باسوردات حسابات الزباين على الموقع الشغّال دلوقتي **متخزّنة في ذاكرة السيرفر بس**.
>
> - أي إعادة تشغيل أو نشر جديد بتمسحها، والزبون مش هيقدر يدخل تاني.
> - كمان لو نفس الإيميل اتسجّل في متجرين، الاتنين بيتلخبطوا في بعض.
>
> **الحل في الخطة دي:**
>
> - الباسوردات تتخزّن في قاعدة البيانات، **متشفّرة بطريقة ما تترجعش** (scrypt).
> - كل متجر حساباته منفصلة.
> - الحساب يتقفل 15 دقيقة بعد 10 محاولات غلط.
>
> ده الأساس اللي تسجيل دخول التاجر (خطة 1B-2) هيتبني عليه بعد كده.

**Goal:** Replace the process-memory, plaintext-compared password provider with a tenant-scoped, Postgres-backed, scrypt-hashed one, so customer (and later staff) logins survive restarts and never collide across shops.

**Architecture:**

- A `HashedPasswordAuthProvider` implements Security's existing `AuthenticationProviderPort`, plus a new `PasswordRegistrar` port.
- It stores records through a `PasswordCredentialStore` port, which has two implementations: in-memory (tests and local) and Prisma (`security.password_credentials`, RLS-forced).
- `Authenticate` already has a per-call `tenantId`. It now forwards that `tenantId` to the provider.
- `wireSecurity` takes the provider through a new optional `passwordAuthProvider` dep, following the same `deps.X ?? default` seam as `mfaProviders`.
- The runtime passes the Prisma-backed one whenever it has a database.
- Without it, everything behaves exactly as today. The existing `InMemoryPasswordAuthProvider` and every test that seeds it are untouched.

**Tech Stack:** TypeScript, vitest, `node:crypto` `scrypt` (no new dependency), Prisma 6 multi-file schema, `@platform/db` `runInTenantTransaction` / `runReadScoped`.

**Spec:**

- [docs/plans/PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 0, unit 2 "Identity".
- [docs/plans/PLATFORM-GAP-REVIEW.md](../../plans/PLATFORM-GAP-REVIEW.md): §2.8.
- Prior art and the known limitation: the doc comment above `customerCredentials` in `apps/admin/src/composition.ts` (≈ line 866), and the T5.17 entry in `docs/plans/BLOCKERS.md`.

## Global Constraints

The same standing rules as Plan 1A. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. Never force-push. Never `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit subjects start lowercase. Each line must be at most 100 characters (commitlint).
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **Never set `TENANT_MODE=multi` in any env file, example, manifest or CI config.**
- **Agents must not connect to any database.**
  - Write the migration only. The owner deploys it from Railway's Console.
  - Do not set `DATABASE_URL_TEST`.
  - `prisma generate` does not connect and is allowed.

### Secrets

- Never print or log any password, hash, salt, secret or token.
- Tests use obviously fake passwords.

### Windows host and commands

- Never run bare `turbo` or root scripts.
- Use per-package commands:
  - `pnpm.cmd --filter <pkg> run test`
  - `pnpm.cmd --filter <pkg> run typecheck`
- Never run a full typecheck and a full test suite at the same time.
- No Python, no `gh`. For quoting trouble, write a `.cjs` script to the scratchpad.
- Package filters:

| Directory           | Package filter       |
| ------------------- | -------------------- |
| `services/security` | `@platform/security` |
| `apps/admin`        | `@platform/admin`    |
| `apps/runtime`      | `@platform/runtime`  |
| `packages/db`       | `@platform/db`       |

### Code conventions

- Match the surrounding code:
  - explicit `private readonly` fields assigned in the constructor, never constructor parameter properties, in **new** files;
  - `Result`/`err`/`ok` from `@platform/types`;
  - errors from `@platform/utils`.
- Hashing parameters:
  - scrypt **N = 2^15, r = 8, p = 1**, 64-byte key, 16-byte random salt;
  - `maxmem` 64 MiB;
  - stored as `scrypt$15$8$1$<salt b64>$<hash b64>`.
- Lockout: **10** consecutive failures lock the credential for **900 s**. A success resets the counter.
- Passwords must be 8 to 256 characters.

---

## File Structure

### `services/security/src/`

- **`infrastructure/scrypt-password-hasher.ts`** (new), with `scrypt-password-hasher.test.ts`: `ScryptPasswordHasher` with `hash`, `verify` and `needsRehash`.
- **`application/password-credentials.ts`** (new):
  - the `PasswordCredentialStore` port;
  - `PasswordCredentialRecord`;
  - the `PasswordRegistrar` port;
  - `PasswordHasher`;
  - `normalizeIdentifier`.
- **`infrastructure/hashed-password-auth-provider.ts`** (new), with `hashed-password-auth-provider.test.ts`.
- **`infrastructure/in-memory-password-credential-store.ts`** (new).
- **`infrastructure/prisma-password-credential-store.ts`** (new).
- **`application/auth-ports.ts`** (modify): `AuthenticationRequest.tenantId?`.
- **`application/authentication.use-cases.ts`** (modify): `Authenticate` forwards `tenantId`.
- **`composition.ts`** (modify): `SecurityWiringDeps.passwordAuthProvider?` and `WiredSecurity.passwordRegistrar`.
- **`index.ts`** (modify): exports.

### `packages/db/`

- **`prisma/schema/security.prisma`** (modify): the `SecurityPasswordCredential` model.
- **`prisma/schema/migrations/20261006000000_security_password_credentials/migration.sql`** (new).
- **`src/schema-migration-consistency.test.ts`** (modify).

### `apps/admin/src/`

- **`interfaces/customer-credentials.port.ts`** (modify): `setPassword` gains a `tenantId` argument.
- **`interfaces/customer-auth.admin-controller.ts`** (modify, line ≈ 191): passes `tenantId`.
- **`composition.ts`** (modify): `AdminWiringDeps.passwordAuthProvider?`; `customerCredentials.setPassword` uses `security.passwordRegistrar`.
- **`http/durable-customer-login.test.ts`** (new).

### `apps/runtime/src/`

- **`api.ts`** (modify): passes a Prisma-backed `HashedPasswordAuthProvider` when `runtime.prisma` exists.

### Docs

- **`docs/KNOWN_GAPS.md`** and **`docs/architecture/23-platform-gap-register.md`**: two entries.

---

### Task 1: `ScryptPasswordHasher`

**Files:**

- Create: `services/security/src/application/password-credentials.ts` (only the `PasswordHasher` interface in this task)
- Create: `services/security/src/infrastructure/scrypt-password-hasher.ts`
- Test: `services/security/src/infrastructure/scrypt-password-hasher.test.ts`

**Interfaces:**

- Produces:
  - `interface PasswordHasher { hash(password: string): Promise<string>; verify(password: string, stored: string): Promise<boolean>; needsRehash(stored: string): boolean }`
  - `class ScryptPasswordHasher implements PasswordHasher`, with an optional constructor `{ log2N?: number }`. Tests use a small N for speed.

- [ ] **Step 1: Write the failing test**

```ts
// services/security/src/infrastructure/scrypt-password-hasher.test.ts
import { describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "./scrypt-password-hasher";

// log2N 10 keeps the suite fast; production uses the default (15).
const hasher = new ScryptPasswordHasher({ log2N: 10 });

describe("ScryptPasswordHasher", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hasher.hash("fake-password-1");
    expect(await hasher.verify("fake-password-1", stored)).toBe(true);
    expect(await hasher.verify("fake-password-2", stored)).toBe(false);
  });

  it("salts: the same password hashes differently twice", async () => {
    const a = await hasher.hash("fake-password-1");
    const b = await hasher.hash("fake-password-1");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$10$8$1$")).toBe(true);
  });

  it("never stores the password itself", async () => {
    const stored = await hasher.hash("fake-password-1");
    expect(stored).not.toContain("fake-password-1");
  });

  it("returns false (never throws) for a malformed stored value", async () => {
    for (const bad of [
      "",
      "plain",
      "scrypt$x$8$1$a$b",
      "bcrypt$10$8$1$AAAA$BBBB",
      "scrypt$10$8$1$$",
    ]) {
      expect(await hasher.verify("fake-password-1", bad)).toBe(false);
    }
  });

  it("flags hashes made with other parameters for rehash", async () => {
    const weak = await new ScryptPasswordHasher({ log2N: 10 }).hash("fake-password-1");
    expect(new ScryptPasswordHasher({ log2N: 10 }).needsRehash(weak)).toBe(false);
    expect(new ScryptPasswordHasher({ log2N: 11 }).needsRehash(weak)).toBe(true);
    expect(new ScryptPasswordHasher({ log2N: 10 }).needsRehash("garbage")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/security run test -- scrypt-password-hasher`
Expected: FAIL, `Cannot find module './scrypt-password-hasher'`.

- [ ] **Step 3: Write the implementation**

```ts
// services/security/src/application/password-credentials.ts
/** Plan 1B-1: one-way password hashing. Implementations never return or log the password. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False — never a throw — for a wrong password or a malformed stored value. */
  verify(password: string, stored: string): Promise<boolean>;
  /** True when `stored` was made with parameters other than this hasher's current ones. */
  needsRehash(stored: string): boolean;
}
```

```ts
// services/security/src/infrastructure/scrypt-password-hasher.ts
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { PasswordHasher } from "../application/password-credentials";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const R = 8;
const P = 1;
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

interface Parsed {
  readonly log2N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, hash] = parts;
  const log2N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (![log2N, rr, pp].every((v) => Number.isInteger(v) && v > 0) || log2N > 20) return null;
  if (salt === undefined || hash === undefined || salt === "" || hash === "") return null;
  const saltBuf = Buffer.from(salt, "base64");
  const hashBuf = Buffer.from(hash, "base64");
  if (saltBuf.length === 0 || hashBuf.length !== KEY_LENGTH) return null;
  return { log2N, r: rr, p: pp, salt: saltBuf, hash: hashBuf };
}

/**
 * Plan 1B-1: scrypt password hashing on `node:crypto` (no dependency). Format:
 * `scrypt$<log2N>$<r>$<p>$<salt base64>$<hash base64>`. Production default N = 2^15, r = 8, p = 1.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly log2N: number;

  constructor(options: { readonly log2N?: number } = {}) {
    this.log2N = options.log2N ?? 15;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, { N: 2 ** this.log2N, r: R, p: P, maxmem: MAX_MEM });
    return `scrypt$${this.log2N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (parsed === null) return false;
    try {
      const key = await derive(password, parsed.salt, {
        N: 2 ** parsed.log2N,
        r: parsed.r,
        p: parsed.p,
        maxmem: MAX_MEM,
      });
      return timingSafeEqual(key, parsed.hash);
    } catch {
      return false;
    }
  }

  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    return parsed === null || parsed.log2N !== this.log2N || parsed.r !== R || parsed.p !== P;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm.cmd --filter @platform/security run test -- scrypt-password-hasher`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add services/security/src/application/password-credentials.ts services/security/src/infrastructure/scrypt-password-hasher.ts services/security/src/infrastructure/scrypt-password-hasher.test.ts
git commit -m "feat(security): add scrypt password hasher"
```

---

### Task 2: Credential store port, in-memory store, `HashedPasswordAuthProvider`

**Files:**

- Modify: `services/security/src/application/password-credentials.ts` (append)
- Modify: `services/security/src/application/auth-ports.ts` (`AuthenticationRequest` gains `tenantId?`)
- Create: `services/security/src/infrastructure/in-memory-password-credential-store.ts`
- Create: `services/security/src/infrastructure/hashed-password-auth-provider.ts`
- Test: `services/security/src/infrastructure/hashed-password-auth-provider.test.ts`

**Interfaces:**

- Consumes: `PasswordHasher` (Task 1); `AuthenticationProviderPort` and `AuthenticationRequest` (existing, `application/auth-ports.ts`).
- Produces (exact shapes below):
  - `PasswordCredentialRecord`, `PasswordCredentialStore`, `PasswordRegistrar`, `normalizeIdentifier`
  - `InMemoryPasswordCredentialStore`
  - `HashedPasswordAuthProvider({ store, hasher, clock, maxFailures?, lockoutSeconds? })`

- [ ] **Step 1: Write the failing test**

```ts
// services/security/src/infrastructure/hashed-password-auth-provider.test.ts
import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { HashedPasswordAuthProvider } from "./hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "./in-memory-password-credential-store";
import { ScryptPasswordHasher } from "./scrypt-password-hasher";

function setup(start = 0) {
  let now = start;
  const clock: Clock = { now: () => new Date(now) };
  const store = new InMemoryPasswordCredentialStore();
  const provider = new HashedPasswordAuthProvider({
    store,
    hasher: new ScryptPasswordHasher({ log2N: 10 }),
    clock,
    maxFailures: 3,
    lockoutSeconds: 60,
  });
  return { provider, store, advance: (ms: number) => (now += ms) };
}

const login = (tenantId: string | undefined, identifier: string, credential: string) => ({
  method: "password" as const,
  identifier,
  credential,
  ...(tenantId === undefined ? {} : { tenantId }),
});

describe("HashedPasswordAuthProvider", () => {
  it("authenticates a registered identifier, case- and space-insensitively", async () => {
    const { provider } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "Sara@Example.com",
      password: "fake-password-1",
      principalExternalId: "cust-1",
    });
    const result = await provider.authenticate(
      login("shop-a", "  sara@example.COM ", "fake-password-1"),
    );
    expect(result).toEqual({ ok: true, principalExternalId: "cust-1" });
  });

  it("keeps shops apart: the same email in two shops is two credentials", async () => {
    const { provider } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-a",
      principalExternalId: "a-1",
    });
    await provider.setPassword({
      tenantId: "shop-b",
      identifier: "x@y.com",
      password: "fake-password-b",
      principalExternalId: "b-1",
    });
    expect((await provider.authenticate(login("shop-a", "x@y.com", "fake-password-b"))).ok).toBe(
      false,
    );
    expect(await provider.authenticate(login("shop-b", "x@y.com", "fake-password-b"))).toEqual({
      ok: true,
      principalExternalId: "b-1",
    });
  });

  it("refuses without a tenant scope, for unknown identifiers and wrong passwords", async () => {
    const { provider } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    expect((await provider.authenticate(login(undefined, "x@y.com", "fake-password-1"))).ok).toBe(
      false,
    );
    expect(
      (await provider.authenticate(login("shop-a", "nobody@y.com", "fake-password-1"))).ok,
    ).toBe(false);
    expect((await provider.authenticate(login("shop-a", "x@y.com", "wrong-password"))).ok).toBe(
      false,
    );
  });

  it("locks after maxFailures for lockoutSeconds, then lets the right password in", async () => {
    const { provider, advance } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    for (let i = 0; i < 3; i += 1)
      await provider.authenticate(login("shop-a", "x@y.com", "wrong-password"));
    const locked = await provider.authenticate(login("shop-a", "x@y.com", "fake-password-1"));
    expect(locked).toEqual({ ok: false, reason: "credential temporarily locked" });
    advance(61_000);
    expect((await provider.authenticate(login("shop-a", "x@y.com", "fake-password-1"))).ok).toBe(
      true,
    );
  });

  it("a success resets the failure counter", async () => {
    const { provider, store } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    await provider.authenticate(login("shop-a", "x@y.com", "wrong-password"));
    await provider.authenticate(login("shop-a", "x@y.com", "fake-password-1"));
    expect((await store.find("shop-a", "x@y.com"))?.failedAttempts).toBe(0);
  });

  it("rejects passwords shorter than 8 or longer than 256 characters", async () => {
    const { provider } = setup();
    const base = { tenantId: "shop-a", identifier: "x@y.com", principalExternalId: "a-1" };
    await expect(provider.setPassword({ ...base, password: "short" })).rejects.toThrow(/8/);
    await expect(provider.setPassword({ ...base, password: "a".repeat(257) })).rejects.toThrow(
      /256/,
    );
  });

  it("stores only a hash", async () => {
    const { provider, store } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    const record = await store.find("shop-a", "x@y.com");
    expect(record?.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(record?.passwordHash).not.toContain("fake-password-1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/security run test -- hashed-password-auth-provider`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

In `services/security/src/application/auth-ports.ts`, add to `AuthenticationRequest`, as its first field:

```ts
  /**
   * Plan 1B-1: the per-call tenant scope (ADR-0014), forwarded by `Authenticate`. Providers whose
   * accounts are tenant-scoped (HashedPasswordAuthProvider) refuse a request without it.
   */
  readonly tenantId?: string;
```

Append to `services/security/src/application/password-credentials.ts`:

```ts
/** Plan 1B-1: one stored password credential. Keyed by (tenantId, normalised identifier). */
export interface PasswordCredentialRecord {
  readonly tenantId: string;
  readonly identifier: string;
  readonly principalExternalId: string;
  readonly passwordHash: string;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

export interface PasswordCredentialStore {
  find(tenantId: string, identifier: string): Promise<PasswordCredentialRecord | null>;
  /** Insert or replace the hash and owner; resets failures and any lock. */
  save(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly principalExternalId: string;
    readonly passwordHash: string;
  }): Promise<void>;
  /** Atomically adds one failure and returns the new count. */
  incrementFailures(tenantId: string, identifier: string): Promise<number>;
  lockUntil(tenantId: string, identifier: string, until: Date): Promise<void>;
  /** Resets failures and lock; replaces the hash when `rehash` is given. */
  recordSuccess(tenantId: string, identifier: string, rehash?: string): Promise<void>;
}

/** Plan 1B-1: sets a principal's password. The only write path for password credentials. */
export interface PasswordRegistrar {
  setPassword(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly password: string;
    readonly principalExternalId: string;
  }): Promise<void>;
}

/** Login identifiers are emails: trimmed and lower-cased so "A@x.com " and "a@x.com" are one account. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}
```

```ts
// services/security/src/infrastructure/in-memory-password-credential-store.ts
import type {
  PasswordCredentialRecord,
  PasswordCredentialStore,
} from "../application/password-credentials";

/** Plan 1B-1: reference store for tests and local dev. Survives nothing — the Prisma store does. */
export class InMemoryPasswordCredentialStore implements PasswordCredentialStore {
  private readonly rows = new Map<string, PasswordCredentialRecord>();

  private static key(tenantId: string, identifier: string): string {
    return `${tenantId}\u0000${identifier}`;
  }

  async find(tenantId: string, identifier: string): Promise<PasswordCredentialRecord | null> {
    return this.rows.get(InMemoryPasswordCredentialStore.key(tenantId, identifier)) ?? null;
  }

  async save(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly principalExternalId: string;
    readonly passwordHash: string;
  }): Promise<void> {
    this.rows.set(InMemoryPasswordCredentialStore.key(input.tenantId, input.identifier), {
      ...input,
      failedAttempts: 0,
      lockedUntil: null,
    });
  }

  async incrementFailures(tenantId: string, identifier: string): Promise<number> {
    const key = InMemoryPasswordCredentialStore.key(tenantId, identifier);
    const row = this.rows.get(key);
    if (row === undefined) return 0;
    const next = { ...row, failedAttempts: row.failedAttempts + 1 };
    this.rows.set(key, next);
    return next.failedAttempts;
  }

  async lockUntil(tenantId: string, identifier: string, until: Date): Promise<void> {
    const key = InMemoryPasswordCredentialStore.key(tenantId, identifier);
    const row = this.rows.get(key);
    if (row !== undefined) this.rows.set(key, { ...row, lockedUntil: until });
  }

  async recordSuccess(tenantId: string, identifier: string, rehash?: string): Promise<void> {
    const key = InMemoryPasswordCredentialStore.key(tenantId, identifier);
    const row = this.rows.get(key);
    if (row === undefined) return;
    this.rows.set(key, {
      ...row,
      failedAttempts: 0,
      lockedUntil: null,
      ...(rehash === undefined ? {} : { passwordHash: rehash }),
    });
  }
}
```

```ts
// services/security/src/infrastructure/hashed-password-auth-provider.ts
import type { Clock } from "@platform/contracts";
import { ValidationError } from "@platform/utils";
import type {
  AuthenticationProviderPort,
  AuthenticationRequest,
  AuthenticationResult,
} from "../application/auth-ports";
import {
  normalizeIdentifier,
  type PasswordCredentialStore,
  type PasswordHasher,
  type PasswordRegistrar,
} from "../application/password-credentials";
import type { AuthMethodKind } from "../domain/value-objects/auth-method";

export interface HashedPasswordAuthProviderDeps {
  readonly store: PasswordCredentialStore;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
  readonly maxFailures?: number;
  readonly lockoutSeconds?: number;
}

const INVALID: AuthenticationResult = { ok: false, reason: "invalid credentials" };
// A fixed throwaway hash for unknown identifiers, so they cost the same scrypt time as a wrong password.
const DUMMY_PASSWORD = "unknown-identifier-timing-equaliser";

/**
 * Plan 1B-1: the production `"password"` provider — tenant-scoped, scrypt-hashed, lockout after
 * repeated failures. Replaces `InMemoryPasswordAuthProvider` wherever a database exists.
 */
export class HashedPasswordAuthProvider implements AuthenticationProviderPort, PasswordRegistrar {
  readonly method: AuthMethodKind = "password";
  private readonly deps: HashedPasswordAuthProviderDeps;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: HashedPasswordAuthProviderDeps) {
    this.deps = deps;
    this.maxFailures = deps.maxFailures ?? 10;
    this.lockoutMs = (deps.lockoutSeconds ?? 900) * 1000;
  }

  async setPassword(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly password: string;
    readonly principalExternalId: string;
  }): Promise<void> {
    if (input.password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters", [
        { field: "password", message: "must be 8 to 256 characters" },
      ]);
    }
    if (input.password.length > 256) {
      throw new ValidationError("Password must be at most 256 characters", [
        { field: "password", message: "must be 8 to 256 characters" },
      ]);
    }
    await this.deps.store.save({
      tenantId: input.tenantId,
      identifier: normalizeIdentifier(input.identifier),
      principalExternalId: input.principalExternalId,
      passwordHash: await this.deps.hasher.hash(input.password),
    });
  }

  async authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
    const tenantId = request.tenantId;
    if (tenantId === undefined || tenantId === "")
      return { ok: false, reason: "tenant scope required" };
    const identifier = normalizeIdentifier(request.identifier);
    const password = request.credential ?? "";
    const record = await this.deps.store.find(tenantId, identifier);
    if (record === null) {
      await this.deps.hasher.verify(password, await this.dummy());
      return INVALID;
    }
    if (
      record.lockedUntil !== null &&
      record.lockedUntil.getTime() > this.deps.clock.now().getTime()
    ) {
      return { ok: false, reason: "credential temporarily locked" };
    }
    if (!(await this.deps.hasher.verify(password, record.passwordHash))) {
      const failures = await this.deps.store.incrementFailures(tenantId, identifier);
      if (failures >= this.maxFailures) {
        await this.deps.store.lockUntil(
          tenantId,
          identifier,
          new Date(this.deps.clock.now().getTime() + this.lockoutMs),
        );
      }
      return INVALID;
    }
    const rehash = this.deps.hasher.needsRehash(record.passwordHash)
      ? await this.deps.hasher.hash(password)
      : undefined;
    await this.deps.store.recordSuccess(tenantId, identifier, rehash);
    return { ok: true, principalExternalId: record.principalExternalId };
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(DUMMY_PASSWORD);
    return this.dummyHash;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass, then typecheck**

Run: `pnpm.cmd --filter @platform/security run test -- hashed-password-auth-provider scrypt-password-hasher`
Expected: PASS, 12 tests.

Run: `pnpm.cmd --filter @platform/security run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/security/src/application/password-credentials.ts services/security/src/application/auth-ports.ts services/security/src/infrastructure/in-memory-password-credential-store.ts services/security/src/infrastructure/hashed-password-auth-provider.ts services/security/src/infrastructure/hashed-password-auth-provider.test.ts
git commit -m "feat(security): add tenant-scoped hashed password provider with lockout"
```

---

### Task 3: `Authenticate` forwards the tenant, and `wireSecurity` accepts the provider

**Files:**

- Modify: `services/security/src/application/authentication.use-cases.ts` (`Authenticate.execute`, the `provider.authenticate({...})` call, ≈ line 117)
- Modify: `services/security/src/composition.ts` (`SecurityWiringDeps`, the `authProviders` construction ≈ line 436, `WiredSecurity`, the returned object ≈ line 690)
- Modify: `services/security/src/index.ts`
- Test: `services/security/src/password-provider-injection.test.ts` (new)

**Interfaces:**

- Produces:
  - `SecurityWiringDeps.passwordAuthProvider?: AuthenticationProviderPort & PasswordRegistrar`
  - `WiredSecurity.passwordRegistrar: PasswordRegistrar`: the injected provider, or an adapter over the in-memory one
  - `Authenticate` passes `tenantId: input.tenantId` to every provider

- [ ] **Step 1: Write the failing test**

Mirror the setup of the existing `src/mfa-provider-injection.test.ts`. Open it first and reuse its `wireSecurity({...})` call verbatim for the required deps.

```ts
// services/security/src/password-provider-injection.test.ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";
import { HashedPasswordAuthProvider } from "./infrastructure/hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "./infrastructure/in-memory-password-credential-store";
import { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher";

const clock: Clock = { now: () => new Date("2026-10-06T00:00:00.000Z") };

function wire(store: InMemoryPasswordCredentialStore) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: ["cust-1"],
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store,
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
  });
}

describe("wireSecurity — injected password provider (Plan 1B-1)", () => {
  it("authenticates through the injected provider, tenant-scoped, across a 'restart'", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const first = wire(store);
    await first.security.registerAuthMethod({
      tenantId: "shop-a",
      kind: "password",
      displayName: "Password",
    });
    const principal = await first.security.registerPrincipal({
      tenantId: "shop-a",
      externalId: "cust-1",
      kind: "human",
      displayName: "cust-1",
      subjectRef: "cust-1",
    });
    expect(principal.status).toBeLessThan(300);
    await first.passwordRegistrar.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "cust-1",
    });

    // The principal is in `first`'s in-memory repositories, so authenticate on `first`; the point of
    // the second wiring is that the CREDENTIAL lives in the shared store, not in the provider object.
    const ok = await first.security.authenticate({
      tenantId: "shop-a",
      method: "password",
      identifier: "X@Y.com",
      credential: "fake-password-1",
    });
    expect((ok.body as { authenticated: boolean }).authenticated).toBe(true);

    const second = wire(store);
    const record = await store.find("shop-a", "x@y.com");
    expect(record?.principalExternalId).toBe("cust-1");
    expect(second.passwordRegistrar).toBeDefined();

    const otherShop = await first.security.authenticate({
      tenantId: "shop-b",
      method: "password",
      identifier: "x@y.com",
      credential: "fake-password-1",
    });
    expect((otherShop.body as { authenticated?: boolean }).authenticated ?? false).toBe(false);
  });

  it("without an injected provider, passwordRegistrar writes to the in-memory reference provider", async () => {
    let n = 0;
    const wired = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => `id-${(n += 1)}` },
      clock,
    });
    await wired.passwordRegistrar.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "cust-1",
    });
    const result = await wired.passwordProvider.authenticate({
      method: "password",
      identifier: "x@y.com",
      credential: "fake-password-1",
    });
    expect(result.ok).toBe(true);
  });
});
```

> If `authenticate`'s failure response is not 2xx (the use case returns `err` instead of an outcome with `authenticated: false`), assert `otherShop.status >= 400 || !authenticated` instead. Read `Authenticate.fail` (≈ line 276) to see which applies, and keep the assertion strict for whichever one it is.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/security run test -- password-provider-injection`
Expected: FAIL. The typecheck or runtime reports an unknown `passwordAuthProvider` or a missing `passwordRegistrar`.

- [ ] **Step 3: Write the implementation**

In `authentication.use-cases.ts`, change the provider call to:

```ts
const result = await provider.authenticate({
  tenantId: input.tenantId,
  method: input.method,
  identifier: input.identifier,
  ...(input.credential !== undefined ? { credential: input.credential } : {}),
  ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
});
```

In `composition.ts`:

1. Import `type PasswordRegistrar` from `./application/password-credentials`.
2. Add to `SecurityWiringDeps`, next to `mfaProviders`:

```ts
  /**
   * Plan 1B-1: the production `"password"` provider (HashedPasswordAuthProvider over Postgres).
   * Absent ⇒ the in-memory reference provider, exactly as before this field existed.
   */
  readonly passwordAuthProvider?: AuthenticationProviderPort & PasswordRegistrar;
```

3. Replace

```ts
const authProviders = new MapAuthenticationProviderResolver([passwordProvider]);
```

with

```ts
const authProviders = new MapAuthenticationProviderResolver([
  deps.passwordAuthProvider ?? passwordProvider,
]);
// Plan 1B-1: the one write path for passwords. The injected provider when present; otherwise an
// adapter over the in-memory reference provider, which is not tenant-scoped (tests/local only).
const passwordRegistrar: PasswordRegistrar = deps.passwordAuthProvider ?? {
  setPassword: async (input) => {
    passwordProvider.register(input.identifier, input.password, input.principalExternalId);
  },
};
```

4. Add `readonly passwordRegistrar: PasswordRegistrar;` to `WiredSecurity`, and `passwordRegistrar,` to the returned object next to `passwordProvider,`.

   Make sure `AuthenticationProviderPort` is imported in `composition.ts`. It is in `./application/auth-ports`.

In `index.ts`, add:

```ts
export { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher";
export { HashedPasswordAuthProvider } from "./infrastructure/hashed-password-auth-provider";
export { InMemoryPasswordCredentialStore } from "./infrastructure/in-memory-password-credential-store";
export {
  normalizeIdentifier,
  type PasswordCredentialRecord,
  type PasswordCredentialStore,
  type PasswordHasher,
  type PasswordRegistrar,
} from "./application/password-credentials";
```

- [ ] **Step 4: Run the whole security package and typecheck**

Run: `pnpm.cmd --filter @platform/security run test`
Expected: PASS, every existing test plus the new ones.

Run: `pnpm.cmd --filter @platform/security run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/security/src/application/authentication.use-cases.ts services/security/src/composition.ts services/security/src/index.ts services/security/src/password-provider-injection.test.ts
git commit -m "feat(security): accept an injected password provider and forward the tenant"
```

---

### Task 4: Postgres table, migration and `PrismaPasswordCredentialStore`

**Files:**

- Modify: `packages/db/prisma/schema/security.prisma` (append)
- Create: `packages/db/prisma/schema/migrations/20261006000000_security_password_credentials/migration.sql`
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (append)
- Create: `services/security/src/infrastructure/prisma-password-credential-store.ts`
- Modify: `services/security/src/index.ts` (export it)

**Interfaces:**

- Produces: `PrismaPasswordCredentialStore(prisma: Database)` implements `PasswordCredentialStore`. Every statement runs inside `runInTenantTransaction` / `runReadScoped` for the record's tenant, so RLS applies.

- [ ] **Step 1: Write the failing test** (append to `schema-migration-consistency.test.ts`)

```ts
describe("security.password_credentials — migration history matches the Prisma model (Plan 1B-1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("every required column was created by some migration", () => {
    const actual = columnsEverAddedTo("security", "password_credentials", allSql);
    for (const column of [
      "id",
      "tenant_id",
      "identifier",
      "principal_external_id",
      "password_hash",
      "failed_attempts",
      "version",
      "created_at",
      "updated_at",
    ]) {
      expect(actual.has(column), `expected "security"."password_credentials"."${column}"`).toBe(
        true,
      );
    }
  });

  it("is RLS-forced and unique per (tenant, identifier)", () => {
    expect(allSql).toContain(
      'ALTER TABLE "security"."password_credentials" FORCE ROW LEVEL SECURITY;',
    );
    expect(allSql).toContain('CREATE POLICY tenant_isolation ON "security"."password_credentials"');
    expect(allSql).toContain('CREATE UNIQUE INDEX "password_credentials_tenant_id_identifier_key"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration-consistency`
Expected: FAIL on the `password_credentials` columns.

- [ ] **Step 3: Write the model, migration and store**

Append to `packages/db/prisma/schema/security.prisma`:

```prisma
// Plan 1B-1 — one password credential per (tenant, login identifier). Only a scrypt hash is stored
// (`scrypt$<log2N>$<r>$<p>$<salt>$<hash>`); the password itself never reaches the database.
model SecurityPasswordCredential {
  id                  String    @id @db.Uuid
  tenantId            String    @map("tenant_id")
  identifier          String // trimmed + lower-cased email
  principalExternalId String    @map("principal_external_id")
  passwordHash        String    @map("password_hash")
  failedAttempts      Int       @default(0) @map("failed_attempts")
  lockedUntil         DateTime? @map("locked_until")
  version             Int       @default(0)
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  @@unique([tenantId, identifier])
  @@index([tenantId, principalExternalId])
  @@map("password_credentials")
  @@schema("security")
}
```

Create the migration:

```sql
-- Plan 1B-1 — durable, tenant-scoped password credentials (replaces the process-memory provider).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH or BEFORE the
-- release that injects HashedPasswordAuthProvider.
--
-- PURELY ADDITIVE: one new table; nothing existing changes. Passwords registered before this
-- release lived only in process memory and are already gone after any restart, so there is nothing
-- to backfill.
--
-- WHOSE ROW. The shop's own tenant (`tenant_id`), RLS ENABLED and FORCED with the same
-- `tenant_isolation` policy as every tenant-scoped table: one shop's session can never read
-- another shop's credentials. `password_hash` holds only a scrypt hash.

CREATE TABLE "security"."password_credentials" (
  "id"                    UUID         NOT NULL,
  "tenant_id"             TEXT         NOT NULL,
  "identifier"            TEXT         NOT NULL,
  "principal_external_id" TEXT         NOT NULL,
  "password_hash"         TEXT         NOT NULL,
  "failed_attempts"       INTEGER      NOT NULL DEFAULT 0,
  "locked_until"          TIMESTAMP(3),
  "version"               INTEGER      NOT NULL DEFAULT 0,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_credentials_identifier_normalised_check"
    CHECK ("identifier" = lower(btrim("identifier")) AND "identifier" <> ''),
  CONSTRAINT "password_credentials_hash_format_check"
    CHECK ("password_hash" LIKE 'scrypt$%'),
  CONSTRAINT "password_credentials_failed_attempts_check" CHECK ("failed_attempts" >= 0)
);

CREATE UNIQUE INDEX "password_credentials_tenant_id_identifier_key"
  ON "security"."password_credentials" ("tenant_id", "identifier");

CREATE INDEX "password_credentials_tenant_id_principal_external_id_idx"
  ON "security"."password_credentials" ("tenant_id", "principal_external_id");

ALTER TABLE "security"."password_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security"."password_credentials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "security"."password_credentials";
CREATE POLICY tenant_isolation ON "security"."password_credentials" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "security"."password_credentials" IS
  'Plan 1B-1: scrypt-hashed password credentials, one per (tenant, identifier). RLS forced. Never holds a password.';
```

```ts
// services/security/src/infrastructure/prisma-password-credential-store.ts
import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import type {
  PasswordCredentialRecord,
  PasswordCredentialStore,
} from "../application/password-credentials";

/**
 * Plan 1B-1: `security.password_credentials`. Every statement runs inside a tenant-scoped
 * transaction (`app.tenant_id` set), so the forced RLS policy applies — same pattern as
 * services/payments/src/infrastructure/prisma-processed-webhook-store.ts.
 */
export class PrismaPasswordCredentialStore implements PasswordCredentialStore {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async find(tenantId: string, identifier: string): Promise<PasswordCredentialRecord | null> {
    const row = await runReadScoped(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.findUnique({
        where: { tenantId_identifier: { tenantId, identifier } },
      }),
    );
    return row === null
      ? null
      : {
          tenantId: row.tenantId,
          identifier: row.identifier,
          principalExternalId: row.principalExternalId,
          passwordHash: row.passwordHash,
          failedAttempts: row.failedAttempts,
          lockedUntil: row.lockedUntil,
        };
  }

  async save(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly principalExternalId: string;
    readonly passwordHash: string;
  }): Promise<void> {
    await runInTenantTransaction(this.prisma, input.tenantId, (client) =>
      client.securityPasswordCredential.upsert({
        where: { tenantId_identifier: { tenantId: input.tenantId, identifier: input.identifier } },
        create: { id: crypto.randomUUID(), ...input },
        update: {
          principalExternalId: input.principalExternalId,
          passwordHash: input.passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      }),
    );
  }

  async incrementFailures(tenantId: string, identifier: string): Promise<number> {
    return runInTenantTransaction(this.prisma, tenantId, async (client) => {
      const updated = await client.securityPasswordCredential.updateMany({
        where: { tenantId, identifier },
        data: { failedAttempts: { increment: 1 } },
      });
      if (updated.count === 0) return 0;
      const row = await client.securityPasswordCredential.findUnique({
        where: { tenantId_identifier: { tenantId, identifier } },
        select: { failedAttempts: true },
      });
      return row?.failedAttempts ?? 0;
    });
  }

  async lockUntil(tenantId: string, identifier: string, until: Date): Promise<void> {
    await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.updateMany({
        where: { tenantId, identifier },
        data: { lockedUntil: until },
      }),
    );
  }

  async recordSuccess(tenantId: string, identifier: string, rehash?: string): Promise<void> {
    await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.updateMany({
        where: { tenantId, identifier },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          ...(rehash === undefined ? {} : { passwordHash: rehash, version: { increment: 1 } }),
        },
      }),
    );
  }
}
```

Export it from `index.ts`:

```ts
export { PrismaPasswordCredentialStore } from "./infrastructure/prisma-password-credential-store";
```

Regenerate the Prisma client. This does not connect:
`pnpm.cmd --filter @platform/db exec prisma generate`

Use the same command that worked in Plan 1A Task 5.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration-consistency`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/security run typecheck`
Expected: exit 0. `client.securityPasswordCredential` exists.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/security.prisma packages/db/prisma/schema/migrations/20261006000000_security_password_credentials/migration.sql packages/db/src/schema-migration-consistency.test.ts services/security/src/infrastructure/prisma-password-credential-store.ts services/security/src/index.ts
git commit -m "feat(security): persist password credentials in an rls-forced table"
```

---

### Task 5: Customer sign-up uses the registrar; the runtime injects the durable provider

**Files:**

- Modify: `apps/admin/src/interfaces/customer-credentials.port.ts` (`setPassword` signature)
- Modify: `apps/admin/src/interfaces/customer-auth.admin-controller.ts` (≈ line 191)
- Modify: `apps/admin/src/composition.ts` (`AdminWiringDeps`, the `customerCredentials` object ≈ line 889)
- Modify: `apps/runtime/src/api.ts` (`createAdminHttpApi({...})` ≈ line 496)
- Test: `apps/admin/src/http/durable-customer-login.test.ts` (new)

**Interfaces:**

- Consumes: `WiredSecurity.passwordRegistrar` (Task 3); `HashedPasswordAuthProvider`, `PrismaPasswordCredentialStore` and `ScryptPasswordHasher` (Tasks 1–4).
- Produces:
  - `CustomerCredentialsPort.setPassword(identifier, password, principalExternalId, tenantId)`. The new 4th parameter keeps the existing 3-argument test doubles type-compatible.
  - `AdminWiringDeps.passwordAuthProvider?`, which reaches `wireSecurity(deps)` through the existing whole-`deps` pass-through at `composition.ts` ≈ line 824.

- [ ] **Step 1: Write the failing test**

Before writing, open `apps/admin/src/http/public-auth-routes.test.ts` and copy its `wireAdmin({...})` setup and its route-calling helper. The test below names that helper `call` and the composition `buildAdmin`. Adjust the names to what that file uses; keep the assertions.

```ts
// apps/admin/src/http/durable-customer-login.test.ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin } from "../composition";
import { publicAuthRoutes } from "./public-auth-routes";

const clock: Clock = { now: () => new Date("2026-10-06T00:00:00.000Z") };

function build(store: InMemoryPasswordCredentialStore) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const admin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store,
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
  });
  return publicAuthRoutes(admin);
}

function route(all: readonly RouteDefinition[], path: string): RouteDefinition {
  const found = all.find((r) => r.method === "POST" && r.path === path);
  if (found === undefined) throw new Error(`no route POST ${path}`);
  return found;
}

function call(r: RouteDefinition, tenantId: string, body: unknown) {
  return r.handle({
    body,
    params: {},
    query: {},
    context: {
      tenantId,
      principal: { id: "anonymous", kind: "customer", roles: [], tenantId },
      requestId: "r",
    },
  } as never) as Promise<{ status: number; body: unknown }>;
}

describe("customer passwords are durable and tenant-scoped (Plan 1B-1)", () => {
  it("a registered customer can log in, and the stored credential is a hash in the shared store", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const routes = build(store);
    const registered = await call(route(routes, "/public/auth/register"), "shop-a", {
      email: "Sara@Example.com",
      name: "Sara",
      password: "fake-password-1",
    });
    expect(registered.status).toBe(201);
    const login = await call(route(routes, "/public/auth/login"), "shop-a", {
      email: "sara@example.com",
      password: "fake-password-1",
    });
    expect(login.status).toBe(200);
    const record = await store.find("shop-a", "sara@example.com");
    expect(record?.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("the same email registered in another shop does not log in to the first", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const routes = build(store);
    await call(route(routes, "/public/auth/register"), "shop-a", {
      email: "x@y.com",
      name: "A",
      password: "fake-password-a",
    });
    await call(route(routes, "/public/auth/register"), "shop-b", {
      email: "x@y.com",
      name: "B",
      password: "fake-password-b",
    });
    const wrongShop = await call(route(routes, "/public/auth/login"), "shop-a", {
      email: "x@y.com",
      password: "fake-password-b",
    });
    expect(wrongShop.status).toBe(401);
  });
});
```

> If `/public/auth/register`'s body field names differ (check `registerBody` in `public-auth-routes.ts`), use the real names. If the route needs `idempotent` headers at the transport, that does not apply here: `handle` is called directly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- durable-customer-login`
Expected: FAIL. `passwordAuthProvider` is unknown to `wireAdmin`, or the store stays empty because setPassword still goes to the in-memory provider.

- [ ] **Step 3: Write the implementation**

In `customer-credentials.port.ts`, change the signature and extend its doc comment with one line about the tenant:

```ts
  /** … `tenantId` scopes the credential: the same email in two shops is two credentials (Plan 1B-1). */
  setPassword(
    identifier: string,
    password: string,
    principalExternalId: string,
    tenantId: string,
  ): Promise<void>;
```

In `customer-auth.admin-controller.ts` (`provisionCredentials`):

```ts
await this.deps.credentials.setPassword(email, password, customerId, tenantId);
```

In `apps/admin/src/composition.ts`:

1. Import `type AuthenticationProviderPort` and `type PasswordRegistrar` from `@platform/security`. Check that `AuthenticationProviderPort` is exported from its `index.ts`; it is, via `./application/auth-ports` at line ≈ 152.
2. Add to `AdminWiringDeps`, next to `mfaProviders`:

```ts
  /**
   * Plan 1B-1: the durable password provider, passed straight through to `wireSecurity(deps)`.
   * Absent ⇒ Security's in-memory reference provider (tests/local), as before.
   */
  readonly passwordAuthProvider?: AuthenticationProviderPort & PasswordRegistrar;
```

3. Replace the `setPassword` entry of `customerCredentials`:

```ts
    setPassword: async (identifier, password, principalExternalId, tenantId) => {
      await security.passwordRegistrar.setPassword({
        tenantId,
        identifier,
        password,
        principalExternalId,
      });
    },
```

4. Update the doc comment above `customerCredentials`: limitation 1 no longer holds when `passwordAuthProvider` is injected. Replace its first numbered point with a sentence saying so, and cite Plan 1B-1.

In `apps/runtime/src/api.ts`:

- Import `HashedPasswordAuthProvider`, `PrismaPasswordCredentialStore` and `ScryptPasswordHasher` from `@platform/security`. Add the dependency to `apps/runtime/package.json` if it is missing, then run `pnpm.cmd install`.
- Add inside the `createAdminHttpApi({...})` object, after `prisma: runtime.prisma,`:

```ts
    // Plan 1B-1: passwords in Postgres (scrypt, tenant-scoped, lockout) instead of process memory.
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new PrismaPasswordCredentialStore(runtime.prisma),
      hasher: new ScryptPasswordHasher(),
      clock: runtime.clock,
    }),
```

If `runtime.prisma` is optional in that scope, wrap it the same way the surrounding optional deps are wrapped: `...(runtime.prisma === undefined ? {} : { passwordAuthProvider: … })`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/admin run test -- durable-customer-login public-auth-routes public-loyalty-routes public-reviews-routes public-wishlist-routes`
Expected: PASS. The four existing suites keep their 3-argument doubles and still pass.

Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: exit 0.

Run: `pnpm.cmd --filter @platform/runtime run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/interfaces/customer-credentials.port.ts apps/admin/src/interfaces/customer-auth.admin-controller.ts apps/admin/src/composition.ts apps/admin/src/http/durable-customer-login.test.ts apps/runtime/src/api.ts apps/runtime/package.json pnpm-lock.yaml
git commit -m "feat(admin): store customer passwords durably per shop"
```

---

### Task 6: Record the gaps, run every gate, push

**Files:**

- Modify: `docs/KNOWN_GAPS.md`, `docs/architecture/23-platform-gap-register.md`
- Modify: `docs/plans/BLOCKERS.md` (T5.17 entry: one dated line)

- [ ] **Step 1: Write the entries**

Take the next two free `G-` numbers (Plan 1A used G-85). Add both to the two gap files.

**First entry:**

> **G-86 — CLOSED (code) 2026-10-06, Plan 1B-1: customer passwords lived only in process memory.**
>
> - They were compared in plaintext and keyed by email alone.
> - Every restart lost them, and the same email in two shops collided.
> - They now live in `security.password_credentials`: scrypt, tenant-scoped, RLS forced, with lockout after 10 failures.
> - Live once the owner deploys migration `20261006000000_security_password_credentials`.

**Second entry:**

> **G-87 — OPEN 2026-10-06 (found while writing Plan 1B-1, Medium/security): `NodeCrypto` derives its encryption and HMAC keys from the key _ref_ string.**
>
> - The derivation is `scryptSync(ref, "lumo-security", 32)`, and the refs are constants in the source (e.g. `"security.mfa.totp"`).
> - So the "encrypted" TOTP secrets are decryptable by anyone with the source.
> - Fix: derive keys from a secret held in the environment or a KMS (`deps.kms` / `deps.crypto` seam).
> - Not fixed here, because production MFA is still the in-memory stand-in (G-84) and no real TOTP secret is stored yet.
> - Must be fixed before real MFA (Plan 1B-2).

In `docs/plans/BLOCKERS.md`, add one dated line under the T5.17 entry:

> `2026-10-06: limitation 1 resolved by Plan 1B-1 (durable, tenant-scoped HashedPasswordAuthProvider).`

- [ ] **Step 2: Run the gates, sequentially**

Run each, in order:

- `pnpm.cmd --filter @platform/security run test`
- `pnpm.cmd --filter @platform/admin run test`
- `pnpm.cmd --filter @platform/runtime run test`
- `pnpm.cmd --filter @platform/db run test`

Then:

- `pnpm.cmd -r --no-bail run typecheck`
- `pnpm.cmd -r --no-bail run lint`
- `pnpm.cmd arch`

Expected: every one exits 0, with no new lint warnings. The `tenant-mode-guard` classification test must still pass: this plan adds no `TENANT_DEFAULT_ID` read.

- [ ] **Step 3: Commit and push**

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/plans/BLOCKERS.md docs/superpowers/plans/2026-10-06-durable-passwords.md
git commit -m "docs(security): close g-86, open g-87, record plan 1b-1"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- With a database, the runtime authenticates customer passwords against `security.password_credentials`. Nothing about passwords is held in process memory.
- The stored value is `scrypt$…`. No test, log or response contains a password or hash.
- The same email in two shops is two independent credentials (test).
- 10 consecutive failures lock the credential for 15 minutes. A success resets the count (test).
- An unknown identifier costs one scrypt verification, the same as a wrong password.
- Without `passwordAuthProvider`, behaviour and every existing test are unchanged.
- The migration is written and not applied. No agent connected to a database.

## Stop conditions (stop and report in Arabic)

- Any existing test outside the listed files fails.
- `prisma generate` wants a database.
- `Authenticate`'s failure shape makes Task 3's assertion impossible to keep strict.
- `runtime.prisma` turns out to be absent in production composition (then the injection site is wrong).

## Owner steps after merge (not for agents)

1. Railway → API service → Console: `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`. Expect the line `20261006000000_security_password_credentials`.
2. Existing storefront customer accounts made before this release were already lost on every restart. Customers register again once.
