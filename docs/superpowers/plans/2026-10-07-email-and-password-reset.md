# Real Email + Password Reset (Plan 1C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الخطة دي بتضيف:
>
> - **إرسال إيميلات حقيقي** عن طريق Resend، وهي ببلاش لحد 3000 إيميل في الشهر.
> - **"نسيت الباسورد":**
>   - صفحة تكتب فيها إيميلك، فيوصلك لينك صالح **30 دقيقة** وبيتستخدم **مرة واحدة**.
>   - الصفحة دايماً بترد بنفس الرسالة، سواء الإيميل موجود أو لأ، عشان محدش يعرف مين عنده حساب.
> - **"غيّر الباسورد"** من جوّه لوحة التحكم.
> - **إيميل تأكيد حساب الزبون** في المتجر بقى بيتبعت فعلاً، بعد ما كان بيتكتب في الـ logs بس (G-72).
>
> من غير مفتاح Resend، كل حاجة بتشتغل زي ما هي، والإيميلات بتتكتب في الـ logs زي النهارده.

**Goal:**

- Staff can recover a forgotten password by email, and change it while signed in.
- Every email the platform sends goes through one real provider (Resend), with a logging fallback for local and tests.

**Architecture:**

- **Email.** An `EmailSender` port in `apps/admin` has two adapters:
  - `ResendEmailSender`: `fetch` to the Resend HTTP API, no SDK dependency;
  - `LoggingEmailSender`: logs the recipient and subject, **never the body or link**.

  An `EmailSignupEmailAdapter` implements the existing `SignupEmailPort` over `EmailSender`, which closes G-72 once a key is set.

- **Reset tokens.** `services/security` gains a `PasswordResetService` over a new `PasswordResetTokenStore` port:
  - an in-memory store and a Prisma store on `security.password_reset_tokens`;
  - a token is 32 random bytes, and only its SHA-256 is stored;
  - 30-minute expiry, single use, tenant-scoped, RLS forced.
- **Staff controller.** `StaffAuthAdminController` gains `requestPasswordReset`, `completePasswordReset` and `changePassword`.
- **Routes:**
  - two public routes, both rate-limited like the staff login;
  - one authenticated route, under a new `account:update_self` permission that every staff role holds.
- **admin-web** gains `/forgot-password`, `/reset-password` and `/account/password`, plus the link on the native login form.

**Tech Stack:** TypeScript, vitest, `node:crypto` (randomBytes, sha256, timingSafeEqual), Prisma 6, Next.js 15 route handlers. No new npm dependency.

**Spec:**

- [PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 0 unit 2 "Identity"; Phase 1 unit 10 "Notifications".
- Gaps G-49 (no real provider) and G-72 (signup email is the logging adapter).
- Builds on Plans 1B-1 and 1B-2.

## Global Constraints

Same as Plans 1B-1 and 1B-2.

### Git and branch

- Branch `morbeh/w0-w17-w12`. Never force-push. Never `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **No database connection.** Write the migration only. Never set `TENANT_MODE=multi`.

### Secrets and logging

- **Never print, log or commit:**
  - a password;
  - a reset token or reset link;
  - `RESEND_API_KEY`;
  - an email body.
- `LoggingEmailSender` logs `{ to, subject }` only. A test asserts the link is absent from logs.

### Anti-enumeration and abuse

- The reset-request endpoint answers **202 with the same body** whether or not the account exists.
- It is rate-limited to **5 per hour per (tenant, email)**, using the same limiter pattern as `/public/auth/staff/login`.
- Reset completion is rate-limited to **10 per 15 minutes per tenant**.

### Password rules

- A password set by reset or change obeys `HashedPasswordAuthProvider.setPassword`'s 8 to 256 rule.
- A successful reset also clears the lockout. `PasswordCredentialStore.save` already resets failures.

### Windows host and commands

- Use per-package commands: `pnpm.cmd --filter <pkg> run test|typecheck|lint`.
- Never run a full typecheck and a full test suite at the same time.
- No new lint warnings. No `async` without `await`.
- Package filters:

| Directory           | Package filter       |
| ------------------- | -------------------- |
| `services/security` | `@platform/security` |
| `packages/auth`     | `@platform/auth`     |
| `apps/admin`        | `@platform/admin`    |
| `apps/runtime`      | `@platform/runtime`  |
| `apps/admin-web`    | `admin-web`          |
| `packages/db`       | `@platform/db`       |

---

## File Structure

### `services/security/src/`

- **`application/password-reset.ts`** (new): the `PasswordResetTokenStore` port and `PasswordResetService`.
- **`application/password-reset.test.ts`** (new).
- **`infrastructure/in-memory-password-reset-token-store.ts`** (new).
- **`infrastructure/prisma-password-reset-token-store.ts`** (new).
- **`application/password-credentials.ts`** (modify): `PasswordCredentialStore.findByPrincipal`.
- **`infrastructure/in-memory-password-credential-store.ts`** and **`infrastructure/prisma-password-credential-store.ts`** (modify): implement it.
- **`composition.ts`** (modify): `SecurityWiringDeps.passwordResetTokens?`; `WiredSecurity.passwordReset`.
- **`index.ts`** (modify).

### `packages/db/`

- **`prisma/schema/security.prisma`** (modify): the `SecurityPasswordResetToken` model.
- **`prisma/schema/migrations/20261007000000_security_password_reset_tokens/migration.sql`** (new).
- **`src/schema-migration-consistency.test.ts`** (modify).

### `packages/auth/src/`

- **`role-table-access-control.ts`** (modify): every role gains `account:update_self`.

### `apps/admin/src/`

- **`interfaces/email-sender.port.ts`** (new).
- **`infrastructure/logging-email-sender.ts`** and **`infrastructure/resend-email-sender.ts`** (new), with `resend-email-sender.test.ts`.
- **`infrastructure/email-templates.ts`** (new): bilingual subject and text for reset and signup.
- **`infrastructure/email-signup-email-adapter.ts`** (new): `SignupEmailPort` over `EmailSender`.
- **`interfaces/staff-auth.admin-controller.ts`** (modify): reset and change methods.
- **`http/public-staff-auth-routes.ts`** (modify): two public routes.
- **`http/staff-account-routes.ts`** (new): `POST /auth/staff/password`.
- **`http/staff-password-reset.test.ts`** (new).
- **`composition.ts`** (modify): `AdminWiringDeps.emailSender?`, `adminPublicUrl?`; wiring.
- **`http/admin-routes.ts`** (modify): mount the account routes.

### `apps/runtime/src/`

- **`config.ts`** (modify): `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_PUBLIC_URL`.
- **`api.ts`** (modify): pass `emailSender`, `adminPublicUrl` and a real `signupEmail` when configured; inject the Prisma reset-token store.
- **`config.email.test.ts`** (new).

### `apps/admin-web/src/`

- **`app/forgot-password/page.tsx`** and **`app/auth/forgot/route.ts`** (new).
- **`app/reset-password/page.tsx`** and **`app/auth/reset/route.ts`** (new).
- **`app/account/password/page.tsx`** and **`app/account/password/actions.ts`** (new).
- **`lib/auth/password-reset.ts`** (new), with `password-reset.test.ts`.
- **`app/login/native-login-form.tsx`** (modify): the "forgot password" link and the `?reset=done` notice.
- **`components/account-menu.tsx`** (modify): a "Change password" item.
- **`middleware.ts`** (modify): public prefixes.

### Docs

- `infrastructure/railway/README.md`, `docs/KNOWN_GAPS.md`, `docs/architecture/23-platform-gap-register.md`.

---

### Task 1: Reset-token store and `PasswordResetService`

**Files:**

- Create: `services/security/src/application/password-reset.ts`
- Create: `services/security/src/infrastructure/in-memory-password-reset-token-store.ts`
- Modify: `services/security/src/application/password-credentials.ts`, and the in-memory credential store (`findByPrincipal`)
- Test: `services/security/src/application/password-reset.test.ts`

**Interfaces:**

- Produces:

```ts
interface PasswordResetTokenRecord {
  tenantId: string;
  tokenHash: string;
  identifier: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface PasswordResetTokenStore {
  save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void>;
  /** Atomically marks an unused, unexpired token used; returns its record or null. */
  consume(tenantId: string, tokenHash: string, now: Date): Promise<PasswordResetTokenRecord | null>;
}

// added to PasswordCredentialStore:
findByPrincipal(tenantId: string, principalExternalId: string): Promise<PasswordCredentialRecord | null>;

class PasswordResetService {
  constructor(deps: {
    tokens: PasswordResetTokenStore;
    credentials: PasswordCredentialStore;
    registrar: PasswordRegistrar;
    clock: Clock;
    ttlSeconds?: number;
  });
  /** null when no credential exists — the caller must still answer exactly as for a hit. */
  request(tenantId: string, identifier: string): Promise<{ token: string } | null>;
  complete(tenantId: string, token: string, newPassword: string): Promise<boolean>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// services/security/src/application/password-reset.test.ts
import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { HashedPasswordAuthProvider } from "../infrastructure/hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "../infrastructure/in-memory-password-credential-store";
import { InMemoryPasswordResetTokenStore } from "../infrastructure/in-memory-password-reset-token-store";
import { ScryptPasswordHasher } from "../infrastructure/scrypt-password-hasher";
import { PasswordResetService } from "./password-reset";

function setup() {
  let now = Date.parse("2026-10-07T10:00:00Z");
  const clock: Clock = { now: () => new Date(now) };
  const credentials = new InMemoryPasswordCredentialStore();
  const provider = new HashedPasswordAuthProvider({
    store: credentials,
    hasher: new ScryptPasswordHasher({ log2N: 10 }),
    clock,
  });
  const tokens = new InMemoryPasswordResetTokenStore();
  const service = new PasswordResetService({
    tokens,
    credentials,
    registrar: provider,
    clock,
    ttlSeconds: 1800,
  });
  const login = (password: string) =>
    provider.authenticate({
      tenantId: "t",
      method: "password",
      identifier: "staff:o@x.test",
      credential: password,
    });
  return { service, provider, tokens, login, advance: (ms: number) => (now += ms) };
}

describe("PasswordResetService (Plan 1C)", () => {
  it("issues a token for a known identifier and none for an unknown one", async () => {
    const { service, provider } = setup();
    await provider.setPassword({
      tenantId: "t",
      identifier: "staff:o@x.test",
      password: "old-password-1",
      principalExternalId: "p-1",
    });
    const hit = await service.request("t", "staff:o@x.test");
    expect(hit?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await service.request("t", "staff:nobody@x.test")).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const { service, provider, tokens } = setup();
    await provider.setPassword({
      tenantId: "t",
      identifier: "staff:o@x.test",
      password: "old-password-1",
      principalExternalId: "p-1",
    });
    const hit = await service.request("t", "staff:o@x.test");
    expect(JSON.stringify(tokens)).not.toContain(hit?.token ?? "x");
  });

  it("a token changes the password once; replay, expiry, other tenant and garbage all fail", async () => {
    const { service, provider, login, advance } = setup();
    await provider.setPassword({
      tenantId: "t",
      identifier: "staff:o@x.test",
      password: "old-password-1",
      principalExternalId: "p-1",
    });
    const first = await service.request("t", "staff:o@x.test");
    expect(await service.complete("other", first?.token ?? "", "new-password-1")).toBe(false);
    expect(await service.complete("t", first?.token ?? "", "new-password-1")).toBe(true);
    expect((await login("new-password-1")).ok).toBe(true);
    expect((await login("old-password-1")).ok).toBe(false);
    expect(await service.complete("t", first?.token ?? "", "another-password")).toBe(false);
    const second = await service.request("t", "staff:o@x.test");
    advance(1801_000);
    expect(await service.complete("t", second?.token ?? "", "late-password-1")).toBe(false);
    expect(await service.complete("t", "garbage", "whatever-password")).toBe(false);
  });

  it("a too-short new password is refused and does not burn the token", async () => {
    const { service, provider } = setup();
    await provider.setPassword({
      tenantId: "t",
      identifier: "staff:o@x.test",
      password: "old-password-1",
      principalExternalId: "p-1",
    });
    const hit = await service.request("t", "staff:o@x.test");
    await expect(service.complete("t", hit?.token ?? "", "short")).rejects.toThrow(/8/);
    expect(await service.complete("t", hit?.token ?? "", "good-password-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/security run test -- password-reset`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// services/security/src/application/password-reset.ts
import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "@platform/contracts";
import { ValidationError } from "@platform/utils";
import {
  normalizeIdentifier,
  type PasswordCredentialStore,
  type PasswordRegistrar,
} from "./password-credentials";

export interface PasswordResetTokenRecord {
  readonly tenantId: string;
  readonly tokenHash: string;
  readonly identifier: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export interface PasswordResetTokenStore {
  save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void>;
  /** Atomically marks an unused, unexpired token used; null when there is none. */
  consume(tenantId: string, tokenHash: string, now: Date): Promise<PasswordResetTokenRecord | null>;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface PasswordResetServiceDeps {
  readonly tokens: PasswordResetTokenStore;
  readonly credentials: PasswordCredentialStore;
  readonly registrar: PasswordRegistrar;
  readonly clock: Clock;
  readonly ttlSeconds?: number;
}

/**
 * Plan 1C: single-use, expiring password-reset tokens. Only SHA-256(token) is stored; the token
 * itself exists once, in the email link. Validation runs BEFORE the token is consumed, so a
 * rejected password does not burn the link.
 */
export class PasswordResetService {
  private readonly deps: PasswordResetServiceDeps;
  private readonly ttlMs: number;

  constructor(deps: PasswordResetServiceDeps) {
    this.deps = deps;
    this.ttlMs = (deps.ttlSeconds ?? 1800) * 1000;
  }

  async request(tenantId: string, identifier: string): Promise<{ token: string } | null> {
    const normalised = normalizeIdentifier(identifier);
    const credential = await this.deps.credentials.find(tenantId, normalised);
    if (credential === null) return null;
    const token = randomBytes(32).toString("base64url");
    await this.deps.tokens.save({
      tenantId,
      tokenHash: hashResetToken(token),
      identifier: normalised,
      expiresAt: new Date(this.deps.clock.now().getTime() + this.ttlMs),
    });
    return { token };
  }

  async complete(tenantId: string, token: string, newPassword: string): Promise<boolean> {
    if (newPassword.length < 8 || newPassword.length > 256) {
      throw new ValidationError("Invalid password", [
        { field: "password", message: "must be at least 8 and at most 256 characters" },
      ]);
    }
    const record = await this.deps.tokens.consume(
      tenantId,
      hashResetToken(token),
      this.deps.clock.now(),
    );
    if (record === null) return false;
    const credential = await this.deps.credentials.find(tenantId, record.identifier);
    if (credential === null) return false;
    await this.deps.registrar.setPassword({
      tenantId,
      identifier: record.identifier,
      password: newPassword,
      principalExternalId: credential.principalExternalId,
    });
    return true;
  }
}
```

```ts
// services/security/src/infrastructure/in-memory-password-reset-token-store.ts
import type {
  PasswordResetTokenRecord,
  PasswordResetTokenStore,
} from "../application/password-reset";

/** Plan 1C: reference store for tests and local dev. */
export class InMemoryPasswordResetTokenStore implements PasswordResetTokenStore {
  private readonly rows = new Map<string, PasswordResetTokenRecord>();

  save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void> {
    this.rows.set(`${record.tenantId}\u0000${record.tokenHash}`, { ...record, usedAt: null });
    return Promise.resolve();
  }

  consume(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null> {
    const key = `${tenantId}\u0000${tokenHash}`;
    const row = this.rows.get(key);
    if (row === undefined || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }
    const used = { ...row, usedAt: now };
    this.rows.set(key, used);
    return Promise.resolve(used);
  }
}
```

Add `findByPrincipal` to the `PasswordCredentialStore` port. Then implement it:

- **In-memory:** iterate the rows, matching `tenantId` and `principalExternalId`, and return the first match or null, via `Promise.resolve`.
- **Prisma:** `runReadScoped` plus `findFirst({ where: { tenantId, principalExternalId } })`, mapped exactly like `find`.

  The model already has `@@index([tenantId, principalExternalId])`.

- [ ] **Step 4: Run the tests**

Run: `pnpm.cmd --filter @platform/security run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/security/src/application/password-reset.ts services/security/src/application/password-reset.test.ts services/security/src/infrastructure/in-memory-password-reset-token-store.ts services/security/src/application/password-credentials.ts services/security/src/infrastructure/in-memory-password-credential-store.ts services/security/src/infrastructure/prisma-password-credential-store.ts
git commit -m "feat(security): add single-use expiring password reset tokens"
```

---

### Task 2: Table, migration and Prisma reset-token store; wiring

**Files:**

- Modify: `packages/db/prisma/schema/security.prisma`
- Create: `packages/db/prisma/schema/migrations/20261007000000_security_password_reset_tokens/migration.sql`
- Modify: `packages/db/src/schema-migration-consistency.test.ts`
- Create: `services/security/src/infrastructure/prisma-password-reset-token-store.ts`
- Modify: `services/security/src/composition.ts`
- Modify: `services/security/src/index.ts`

**Interfaces:**

- Produces:
  - `SecurityWiringDeps.passwordResetTokens?: PasswordResetTokenStore`; absent ⇒ in-memory.
  - `WiredSecurity.passwordReset: PasswordResetService`. It is built only when `deps.passwordAuthProvider` exists; otherwise `undefined`. Type it `PasswordResetService | undefined`.

  The service needs the credential store. Give `HashedPasswordAuthProvider` a read-only `credentialStore` getter that returns `deps.store`, so `wireSecurity` can pass it without a second dep.

- [ ] **Step 1: Write the failing test** (append to `schema-migration-consistency.test.ts`, same shape as the 1B-1 block)

Use:

- table `password_reset_tokens`;
- columns `id`, `tenant_id`, `token_hash`, `identifier`, `expires_at`, `created_at`;
- RLS assertions;
- `CREATE UNIQUE INDEX "password_reset_tokens_tenant_id_token_hash_key"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration-consistency`
Expected: FAIL.

- [ ] **Step 3: Write the model, migration, store and wiring**

```prisma
// Plan 1C — single-use password reset tokens. Only SHA-256(token) is stored; the token lives in the
// email link alone. Expired/used rows are inert; a later retention job may delete them.
model SecurityPasswordResetToken {
  id         String    @id @db.Uuid
  tenantId   String    @map("tenant_id")
  tokenHash  String    @map("token_hash")
  identifier String
  expiresAt  DateTime  @map("expires_at")
  usedAt     DateTime? @map("used_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@unique([tenantId, tokenHash])
  @@index([tenantId, identifier])
  @@map("password_reset_tokens")
  @@schema("security")
}
```

```sql
-- Plan 1C — password reset tokens. Written by hand, NOT applied by the agent. The owner deploys it
-- from Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH
-- or BEFORE the release that serves /public/auth/staff/password-reset/*.
-- PURELY ADDITIVE: one new table. Only a SHA-256 hex digest of each token is stored.

CREATE TABLE "security"."password_reset_tokens" (
  "id"          UUID         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "token_hash"  TEXT         NOT NULL,
  "identifier"  TEXT         NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "used_at"     TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "password_reset_tokens_tenant_id_token_hash_key"
  ON "security"."password_reset_tokens" ("tenant_id", "token_hash");

CREATE INDEX "password_reset_tokens_tenant_id_identifier_idx"
  ON "security"."password_reset_tokens" ("tenant_id", "identifier");

ALTER TABLE "security"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security"."password_reset_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "security"."password_reset_tokens";
CREATE POLICY tenant_isolation ON "security"."password_reset_tokens" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "security"."password_reset_tokens" IS
  'Plan 1C: single-use, expiring password reset tokens (SHA-256 only). RLS forced.';
```

```ts
// services/security/src/infrastructure/prisma-password-reset-token-store.ts
import { runInTenantTransaction, type Database } from "@platform/db";
import type {
  PasswordResetTokenRecord,
  PasswordResetTokenStore,
} from "../application/password-reset";

/** Plan 1C: `security.password_reset_tokens`, every statement tenant-scoped (RLS applies). */
export class PrismaPasswordResetTokenStore implements PasswordResetTokenStore {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void> {
    await runInTenantTransaction(this.prisma, record.tenantId, (client) =>
      client.securityPasswordResetToken.create({ data: { id: crypto.randomUUID(), ...record } }),
    );
  }

  async consume(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null> {
    return runInTenantTransaction(this.prisma, tenantId, async (client) => {
      const claimed = await client.securityPasswordResetToken.updateMany({
        where: { tenantId, tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) return null;
      const row = await client.securityPasswordResetToken.findUnique({
        where: { tenantId_tokenHash: { tenantId, tokenHash } },
      });
      return row === null
        ? null
        : {
            tenantId: row.tenantId,
            tokenHash: row.tokenHash,
            identifier: row.identifier,
            expiresAt: row.expiresAt,
            usedAt: row.usedAt,
          };
    });
  }
}
```

In `composition.ts`:

- Add `readonly passwordResetTokens?: PasswordResetTokenStore;` to `SecurityWiringDeps`.
- Add `readonly passwordReset: PasswordResetService | undefined;` to `WiredSecurity`.
- Build it:

```ts
const passwordReset =
  deps.passwordAuthProvider instanceof HashedPasswordAuthProvider
    ? new PasswordResetService({
        tokens: deps.passwordResetTokens ?? new InMemoryPasswordResetTokenStore(),
        credentials: deps.passwordAuthProvider.credentialStore,
        registrar: deps.passwordAuthProvider,
        clock: deps.clock,
      })
    : undefined;
```

If `passwordAuthProvider`'s declared type makes `instanceof` awkward, add an optional `credentialStore?: PasswordCredentialStore` to the injected type instead. Pick whichever typechecks cleanly; the behaviour is the same.

Export from `index.ts`:

- `PasswordResetService`, `hashResetToken`
- `InMemoryPasswordResetTokenStore`, `PrismaPasswordResetTokenStore`
- the two types

Then run `pnpm.cmd --filter @platform/db exec prisma generate`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/db run test`
Expected: PASS, including `prisma-tenant-where.guard`. If the guard flags a port method named like a Prisma call, rename the port method; never add a guard exemption.

Run: `pnpm.cmd --filter @platform/security run test`
Run: `pnpm.cmd --filter @platform/security run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/security.prisma packages/db/prisma/schema/migrations/20261007000000_security_password_reset_tokens/migration.sql packages/db/src/schema-migration-consistency.test.ts services/security/src
git commit -m "feat(security): persist password reset tokens in an rls-forced table"
```

---

### Task 3: `EmailSender` port, Resend and logging adapters, templates

**Files:**

- Create: `apps/admin/src/interfaces/email-sender.port.ts`
- Create: `apps/admin/src/infrastructure/logging-email-sender.ts`
- Create: `apps/admin/src/infrastructure/resend-email-sender.ts`
- Create: `apps/admin/src/infrastructure/email-templates.ts`
- Create: `apps/admin/src/infrastructure/email-signup-email-adapter.ts`
- Test: `apps/admin/src/infrastructure/resend-email-sender.test.ts`

**Interfaces:**

- Produces:
  - `EmailSender.send({ to, subject, text, html? }): Promise<void>`, which throws on a provider error;
  - `ResendEmailSender({ apiKey, from, fetchImpl? })`;
  - `LoggingEmailSender(logger)`;
  - `passwordResetEmail(link)` and `signupCompleteEmail(link)`, each returning `{ subject, text }` in Arabic and English;
  - `alreadyRegisteredEmail()`;
  - `EmailSignupEmailAdapter(sender)` implements `SignupEmailPort`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/infrastructure/resend-email-sender.test.ts
import { describe, expect, it } from "vitest";
import { LoggingEmailSender } from "./logging-email-sender";
import { ResendEmailSender } from "./resend-email-sender";
import { passwordResetEmail } from "./email-templates";

describe("ResendEmailSender (Plan 1C)", () => {
  it("POSTs to the Resend API with a bearer key and the message", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const sender = new ResendEmailSender({
      apiKey: "re_test_fake",
      from: "Morbeh <onboarding@resend.dev>",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ id: "1" }), { status: 200 });
      }) as typeof fetch,
    });
    await sender.send({ to: "o@x.test", subject: "S", text: "T" });
    expect(seen?.url).toBe("https://api.resend.com/emails");
    expect((seen?.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer re_test_fake",
    );
    expect(JSON.parse(String(seen?.init.body))).toEqual({
      from: "Morbeh <onboarding@resend.dev>",
      to: ["o@x.test"],
      subject: "S",
      text: "T",
    });
  });

  it("throws on a non-2xx answer without echoing the key", async () => {
    const sender = new ResendEmailSender({
      apiKey: "re_test_fake",
      from: "x@y.test",
      fetchImpl: (async () => new Response("nope", { status: 422 })) as typeof fetch,
    });
    await expect(sender.send({ to: "o@x.test", subject: "S", text: "T" })).rejects.toThrow(/422/);
    await expect(sender.send({ to: "o@x.test", subject: "S", text: "T" })).rejects.not.toThrow(
      /re_test_fake/,
    );
  });
});

describe("LoggingEmailSender", () => {
  it("logs recipient and subject only — never the body or link", async () => {
    const lines: string[] = [];
    const logger = {
      info: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f)}`),
    } as never;
    const mail = passwordResetEmail("https://admin.test/reset-password?token=SECRET-TOKEN");
    await new LoggingEmailSender(logger).send({ to: "o@x.test", ...mail });
    expect(lines.join("\n")).toContain("o@x.test");
    expect(lines.join("\n")).not.toContain("SECRET-TOKEN");
  });
});

describe("templates", () => {
  it("are bilingual and carry the link", () => {
    const mail = passwordResetEmail("https://admin.test/reset-password?token=abc");
    expect(mail.text).toContain("https://admin.test/reset-password?token=abc");
    expect(mail.text).toMatch(/[؀-ۿ]/);
    expect(mail.text).toMatch(/password/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- resend-email-sender`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/interfaces/email-sender.port.ts
/** Plan 1C: the one way the platform sends email. Implementations never log the body. */
export interface EmailSender {
  send(message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
  }): Promise<void>;
}
```

```ts
// apps/admin/src/infrastructure/resend-email-sender.ts
import type { EmailSender } from "../interfaces/email-sender.port";

/** Plan 1C: Resend over plain HTTP (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender implements EmailSender {
  private readonly options: {
    readonly apiKey: string;
    readonly from: string;
    readonly fetchImpl?: typeof fetch;
  };

  constructor(options: {
    readonly apiKey: string;
    readonly from: string;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.options = options;
  }

  async send(message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
  }): Promise<void> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      }),
    });
    if (!response.ok) throw new Error(`email provider responded with status ${response.status}`);
  }
}
```

```ts
// apps/admin/src/infrastructure/logging-email-sender.ts
import type { Logger } from "@platform/utils";
import type { EmailSender } from "../interfaces/email-sender.port";

/** Plan 1C: dev/test sender. Logs who and what subject — never the body, which may hold a link. */
export class LoggingEmailSender implements EmailSender {
  private readonly logger: Pick<Logger, "info">;

  constructor(logger: Pick<Logger, "info">) {
    this.logger = logger;
  }

  send(message: { readonly to: string; readonly subject: string }): Promise<void> {
    this.logger.info("email (not sent: logging sender)", {
      to: message.to,
      subject: message.subject,
    });
    return Promise.resolve();
  }
}
```

```ts
// apps/admin/src/infrastructure/email-templates.ts
/** Plan 1C: plain-text, bilingual (Arabic first, then English). */
export function passwordResetEmail(link: string): { subject: string; text: string } {
  return {
    subject: "إعادة تعيين كلمة السر / Reset your password",
    text: [
      "طلبت إعادة تعيين كلمة السر للوحة تحكم مربح.",
      "افتح الرابط ده خلال 30 دقيقة (بيشتغل مرة واحدة):",
      link,
      "لو ما طلبتش ده، تجاهل الرسالة وكلمة السر هتفضل زي ما هي.",
      "",
      "You asked to reset your Morbeh admin password.",
      "Open this link within 30 minutes (it works once):",
      link,
      "If you did not ask for this, ignore this email; your password stays the same.",
    ].join("\n"),
  };
}

export function signupCompleteEmail(link: string): { subject: string; text: string } {
  return {
    subject: "أكمل حسابك / Complete your account",
    text: [
      "اضغط الرابط ده عشان تكمّل حسابك:",
      link,
      "",
      "Use this link to complete your account:",
      link,
    ].join("\n"),
  };
}

export function alreadyRegisteredEmail(): { subject: string; text: string } {
  return {
    subject: "عندك حساب بالفعل / You already have an account",
    text: [
      'فيه حساب بالإيميل ده بالفعل. لو نسيت كلمة السر استخدم "نسيت كلمة السر".',
      "",
      'An account with this email already exists. If you forgot the password, use "Forgot password".',
    ].join("\n"),
  };
}
```

```ts
// apps/admin/src/infrastructure/email-signup-email-adapter.ts
import type { EmailSender } from "../interfaces/email-sender.port";
import type { SignupEmailPort } from "../interfaces/signup-email.port";
import { alreadyRegisteredEmail, signupCompleteEmail } from "./email-templates";

/** Plan 1C (closes G-72 when configured): customer signup emails through the real sender. */
export class EmailSignupEmailAdapter implements SignupEmailPort {
  private readonly sender: EmailSender;

  constructor(sender: EmailSender) {
    this.sender = sender;
  }

  sendCompleteAccountEmail(input: {
    readonly email: string;
    readonly link: string;
  }): Promise<void> {
    return this.sender.send({ to: input.email, ...signupCompleteEmail(input.link) });
  }

  sendAlreadyRegisteredEmail(input: { readonly email: string }): Promise<void> {
    return this.sender.send({ to: input.email, ...alreadyRegisteredEmail() });
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm.cmd --filter @platform/admin run test -- resend-email-sender`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/interfaces/email-sender.port.ts apps/admin/src/infrastructure/logging-email-sender.ts apps/admin/src/infrastructure/resend-email-sender.ts apps/admin/src/infrastructure/email-templates.ts apps/admin/src/infrastructure/email-signup-email-adapter.ts apps/admin/src/infrastructure/resend-email-sender.test.ts
git commit -m "feat(admin): add an email sender with resend and logging adapters"
```

---

### Task 4: Staff reset and change-password endpoints

**Files:**

- Modify: `packages/auth/src/role-table-access-control.ts`: append `"account:update_self"` to `admin` (already covered by `*:*`; add nothing), `operator` and `viewer`. Add one test line in `role-table-access-control.test.ts`: viewer may `account:update_self`; a customer may not.
- Modify: `apps/admin/src/interfaces/staff-auth.admin-controller.ts`
- Modify: `apps/admin/src/http/public-staff-auth-routes.ts`
- Create: `apps/admin/src/http/staff-account-routes.ts`
- Modify: `apps/admin/src/composition.ts`:
  - `AdminWiringDeps` gains `emailSender?: EmailSender` and `adminPublicUrl?: string`;
  - pass `passwordReset`, `emailSender` and `adminPublicUrl` to the staff controller.
- Modify: `apps/admin/src/http/admin-routes.ts`: mount `...staffAccountRoutes(admin)`.
- Test: `apps/admin/src/http/staff-password-reset.test.ts`

**Interfaces:**

- Controller methods:
  - `requestPasswordReset({ tenantId, email })` always returns `{ status: 202, body: { outcome: "sent-if-exists" } }`;
  - `completePasswordReset({ tenantId, token, password })` returns 200 `{ outcome: "reset" }`, 400 `{ error: { code: "INVALID_TOKEN" } }`, or 422 on password rules;
  - `changePassword({ tenantId, principalExternalId, currentPassword, newPassword })` returns 200 `{ outcome: "changed" }`, 401 on a wrong current password, or 422.
- Routes:

| Method | Path                                         | Access                                                                                   | Limit                                 |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| `POST` | `/public/auth/staff/password-reset/request`  | public, body `{ email }`                                                                 | 5/hour per (tenant, normalised email) |
| `POST` | `/public/auth/staff/password-reset/complete` | public, body `{ token, password }`                                                       | 10 per 15 min per tenant              |
| `POST` | `/auth/staff/password`                       | authenticated, permission `account:update_self`, body `{ currentPassword, newPassword }` | —                                     |

`/auth/staff/password` uses `context.principal.id` as `principalExternalId`.

- [ ] **Step 1: Write the failing test**

Reuse the `setup()` / `seedStaff()` / `call()` helpers of `public-staff-auth-routes.test.ts` (Plan 1B-2). Copy them into this file, then add a recording `EmailSender`:

```ts
// apps/admin/src/http/staff-password-reset.test.ts  (helpers copied from public-staff-auth-routes.test.ts)
class RecordingSender {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  send(m: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(m);
    return Promise.resolve();
  }
}
const linkFrom = (text: string) => /https?:\/\/\S+token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("staff password reset and change (Plan 1C)", () => {
  it("request → email with link → complete → sign in with the new password; old one fails", async () => {
    // build wireAdmin with passwordAuthProvider, staffTokenIssuer, emailSender: sender,
    // adminPublicUrl: "https://admin.test"; seedStaff(admin, "platform-admin")
    // 1. POST request {email: "Owner@Example.test"} → 202 {outcome:"sent-if-exists"}; sender.sent.length === 1
    // 2. token = linkFrom(sender.sent[0].text); link starts with "https://admin.test/reset-password?token="
    // 3. POST complete {token, password:"brand-new-pass-1"} → 200
    // 4. login with brand-new-pass-1 → 200; with fake-password-1 → 401
    // 5. POST complete again with the same token → 400 INVALID_TOKEN
  });

  it("an unknown email gets the identical 202 and no email is sent", async () => {
    // POST request {email:"nobody@example.test"} → status 202, body deep-equals the hit's body; sender.sent.length === 0
  });

  it("the sixth request inside an hour is 429 (same shape as the login limiter)", async () => {
    // routes built with an in-memory RateLimiter (reuse the one public-staff-auth-routes.test.ts uses)
  });

  it("change password needs the current one", async () => {
    // POST /auth/staff/password with context.principal = { id: "staff-1", kind:"staff", roles:["admin"], tenantId }
    // wrong currentPassword → 401; right → 200; then login with newPassword → 200
  });
});
```

> Write each `it` body fully as described in its comments, using the copied helpers. Every step listed is an assertion; none is optional.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- staff-password-reset`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Add to `StaffAuthAdminControllerDeps`:

```ts
  readonly passwordReset?: PasswordResetService;
  readonly emailSender?: EmailSender;
  readonly adminPublicUrl?: string;
  readonly passwordRegistrar?: PasswordRegistrar;
  readonly credentialStore?: PasswordCredentialStore;
```

Add the methods:

```ts
  private static readonly SENT: AdminResponse = { status: 202, body: { outcome: "sent-if-exists" } };

  async requestPasswordReset(input: { readonly tenantId: string; readonly email: string }): Promise<AdminResponse> {
    const { passwordReset, emailSender, adminPublicUrl } = this.deps;
    if (passwordReset === undefined || emailSender === undefined || adminPublicUrl === undefined) {
      return StaffAuthAdminController.SENT; // same answer; nothing to send with
    }
    const issued = await passwordReset.request(input.tenantId, staffIdentifier(input.email));
    if (issued !== null) {
      const link = `${adminPublicUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(issued.token)}`;
      try {
        await emailSender.send({ to: input.email.trim().toLowerCase(), ...passwordResetEmail(link) });
      } catch {
        // Provider failure must not change the answer (no enumeration); the token simply expires.
      }
    }
    return StaffAuthAdminController.SENT;
  }

  async completePasswordReset(input: {
    readonly tenantId: string;
    readonly token: string;
    readonly password: string;
  }): Promise<AdminResponse> {
    if (this.deps.passwordReset === undefined) return NOT_CONFIGURED;
    try {
      const done = await this.deps.passwordReset.complete(input.tenantId, input.token, input.password);
      return done
        ? { status: 200, body: { outcome: "reset" } }
        : { status: 400, body: { error: { code: "INVALID_TOKEN", message: "This link is invalid or has expired" } } };
    } catch (error) {
      if (error instanceof ValidationError) return { status: 422, body: toErrorEnvelope(error) };
      throw error;
    }
  }

  async changePassword(input: {
    readonly tenantId: string;
    readonly principalExternalId: string;
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<AdminResponse> {
    const { credentialStore, passwordRegistrar } = this.deps;
    if (credentialStore === undefined || passwordRegistrar === undefined) return NOT_CONFIGURED;
    const credential = await credentialStore.findByPrincipal(input.tenantId, input.principalExternalId);
    if (credential === null || !credential.identifier.startsWith(STAFF_IDENTIFIER_PREFIX)) return UNAUTHENTICATED;
    const verified = await this.deps.security.authenticate({
      tenantId: input.tenantId,
      method: "password",
      identifier: credential.identifier,
      credential: input.currentPassword,
    });
    if ((verified.body as { authenticated?: boolean }).authenticated !== true) return UNAUTHENTICATED;
    try {
      await passwordRegistrar.setPassword({
        tenantId: input.tenantId,
        identifier: credential.identifier,
        password: input.newPassword,
        principalExternalId: input.principalExternalId,
      });
    } catch (error) {
      if (error instanceof ValidationError) return { status: 422, body: toErrorEnvelope(error) };
      throw error;
    }
    return { status: 200, body: { outcome: "changed" } };
  }
```

Imports:

- `ValidationError` and `toErrorEnvelope` from `@platform/utils`;
- `passwordResetEmail` from `../infrastructure/email-templates`;
- the types from `@platform/security` and `./email-sender.port`.

> `changePassword` verifies the current password through `authenticate`, which also establishes a session row. That is acceptable: the session expires. If `authenticate` requires the password auth method to be registered first, call the existing `ensurePasswordMethod` before it.

In `composition.ts`, pass these to the staff controller:

- `passwordReset: security.passwordReset`;
- `emailSender: deps.emailSender`;
- `adminPublicUrl: deps.adminPublicUrl`;
- `passwordRegistrar: security.passwordRegistrar`;
- `credentialStore`, taken from `deps.passwordAuthProvider` (use the same accessor Task 2 introduced).

Use the conditional-spread pattern for every optional one.

Routes:

- **`public-staff-auth-routes.ts`:** add the two public routes. Copy the login limiter block, changing the key and limits:
  - `rl:<tenant>:staff-reset-request:<normalised email>`, 5 per 60 min;
  - `rl:<tenant>:staff-reset-complete`, 10 per 15 min.
- **`staff-account-routes.ts`** (new), modeled on any authenticated route in `admin-routes.ts`:

```ts
const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
  })
  .strict();

export function staffAccountRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/auth/staff/password",
      version: 1,
      permission: "account:update_self",
      summary: "Change the signed-in staff member's own password",
      schema: { body: changePasswordBody },
      handle: ({ body, context }) =>
        admin.staffAuth.changePassword({
          tenantId: context.tenantId,
          principalExternalId: context.principal.id,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        }),
    }),
  ];
}
```

> Under `AUTH_MODE=ory`, `account:update_self` is not granted in Keto, so the route is refused there. That is fine: the route is for native mode. Do not add Keto tuples.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/auth run test`
Run: `pnpm.cmd --filter @platform/admin run test`
Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/role-table-access-control.ts packages/auth/src/role-table-access-control.test.ts apps/admin/src
git commit -m "feat(admin): add staff password reset and change-password endpoints"
```

---

### Task 5: Runtime configuration

**Files:**

- Modify: `apps/runtime/src/config.ts`
- Modify: `apps/runtime/src/api.ts`
- Test: `apps/runtime/src/config.email.test.ts`

**Interfaces:**

- Config keys, all optional:

| Key                | Rule                                       |
| ------------------ | ------------------------------------------ |
| `RESEND_API_KEY`   | min 10, secret                             |
| `EMAIL_FROM`       | default `"Morbeh <onboarding@resend.dev>"` |
| `ADMIN_PUBLIC_URL` | url                                        |

- `api.ts` passes:
  - `emailSender`: `ResendEmailSender` when `RESEND_API_KEY` is set, else `LoggingEmailSender(logger)`;
  - `adminPublicUrl` when set;
  - `signupEmail: new EmailSignupEmailAdapter(emailSender)` **only when `RESEND_API_KEY` is set**, so the existing G-72 guard keeps refusing a non-local deployment that has no real sender;
  - `passwordResetTokens: new PrismaPasswordResetTokenStore(runtime.prisma)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/runtime/src/config.email.test.ts
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

describe("email config (Plan 1C)", () => {
  it("is optional with a Resend sandbox sender by default", () => {
    const c = loadRuntimeConfig({ APP_ENV: "local" });
    expect(c.RESEND_API_KEY).toBeUndefined();
    expect(c.EMAIL_FROM).toBe("Morbeh <onboarding@resend.dev>");
    expect(c.ADMIN_PUBLIC_URL).toBeUndefined();
  });

  it("accepts a key, a sender and an admin URL", () => {
    const c = loadRuntimeConfig({
      APP_ENV: "local",
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <no-reply@example.test>",
      ADMIN_PUBLIC_URL: "https://admin.example.test",
    });
    expect(c.ADMIN_PUBLIC_URL).toBe("https://admin.example.test");
  });

  it("rejects a non-URL admin address", () => {
    expect(() => loadRuntimeConfig({ APP_ENV: "local", ADMIN_PUBLIC_URL: "admin" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/runtime run test -- config.email`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Add the three keys to the schema with doc comments. Mark `RESEND_API_KEY` as a secret in the comment. Wire `api.ts` as described above, with the conditional-spread pattern.

If `passwordResetTokens` must reach `wireSecurity`, it rides through `AdminWiringDeps` the same way `passwordAuthProvider` does in Plan 1B-1. Add `readonly passwordResetTokens?: PasswordResetTokenStore;` to `AdminWiringDeps`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/runtime run test`
Run: `pnpm.cmd --filter @platform/runtime run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src/config.ts apps/runtime/src/api.ts apps/runtime/src/config.email.test.ts apps/admin/src/composition.ts
git commit -m "feat(runtime): configure resend email and password reset storage"
```

---

### Task 6: admin-web pages

**Files:**

- Create: `apps/admin-web/src/lib/auth/password-reset.ts`, with `password-reset.test.ts`
- Create: `apps/admin-web/src/app/forgot-password/page.tsx`, `apps/admin-web/src/app/auth/forgot/route.ts`
- Create: `apps/admin-web/src/app/reset-password/page.tsx`, `apps/admin-web/src/app/auth/reset/route.ts`
- Create: `apps/admin-web/src/app/account/password/page.tsx`, `apps/admin-web/src/app/account/password/actions.ts`
- Modify: `apps/admin-web/src/app/login/native-login-form.tsx`:
  - a "Forgot password? / نسيت كلمة السر؟" link to `/forgot-password`;
  - the notices for `?reset=done` ("Password changed — sign in / اتغيرت كلمة السر، ادخل") and `?reset=sent` (the same neutral text as the forgot page).
- Modify: `apps/admin-web/src/components/account-menu.tsx`: a "Change password / تغيير كلمة السر" item linking to `/account/password`. A plain next/link is fine here: this is not a GET with side effects.
- Modify: `apps/admin-web/src/middleware.ts`: add `"/forgot-password"`, `"/reset-password"`, `"/auth/forgot"` and `"/auth/reset"` to `PUBLIC_PREFIXES`. `/account/password` stays protected, with role `viewer` in `ROUTE_ROLE_REQUIREMENTS`.

**Interfaces:**

- `lib/auth/password-reset.ts` exports:
  - `requestReset({ runtimeUrl, tenantId, email, fetchImpl })`, which returns `"sent" | "limited" | "unavailable"`;
  - `completeReset({ runtimeUrl, tenantId, token, password, fetchImpl })`, which returns `"done" | "invalid" | "weak" | "limited" | "unavailable"`.

  Both use `nativeTenantId()` at their call sites. Model them on `exchangePassword` in `lib/auth/native.ts`: never throw, and map statuses as follows.

| Status        | `requestReset` | `completeReset` |
| ------------- | -------------- | --------------- |
| 202           | `sent`         | —               |
| 200           | —              | `done`          |
| 400           | —              | `invalid`       |
| 422           | —              | `weak`          |
| 429           | `limited`      | `limited`       |
| anything else | `unavailable`  | `unavailable`   |

- [ ] **Step 1: Write the failing test**

Test `requestReset` and `completeReset` with fake `fetchImpl`s for every row of the table above, plus a thrown network error, which maps to `"unavailable"`. Also assert the posted URL and the `x-tenant-id` header, as `native.test.ts` does.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter admin-web run test -- password-reset`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

**Pages.** Follow `native-login-form.tsx`'s markup (`Card`, `Input`, `Label`, `Button`, `BrandMark`):

- `/forgot-password`: an email field. It posts to `/auth/forgot`, and the handler redirects to `/login?reset=sent` whatever the outcome, except `limited`, which goes to `/forgot-password?error=limited`.
- `/reset-password`: reads `token` from the search params into a hidden field, with "new password" and "confirm" fields. It posts to `/auth/reset`. The handler checks that the two fields match (`?error=mismatch`), then calls `completeReset`, and redirects:
  - `done` → `/login?reset=done`;
  - otherwise `/reset-password?token=…&error=<reason>`.

  **Never log the token**, and never put the password in a URL.

- `/account/password`: current, new and confirm fields, with a server action calling `mutateAdminApi("/api/v1/auth/staff/password", { method: "POST", body })`. It shows an inline result for:
  - `ok` → "Password changed / اتغيرت كلمة السر";
  - `unauthorized` → "Current password is wrong / كلمة السر الحالية غلط";
  - `invalid` → "New password must be 8–256 characters / كلمة السر الجديدة لازم تكون من 8 لـ 256 حرف";
  - anything else → "Try again later / حاول تاني بعدين".

  Check how `mutateAdminApi` builds its URL. If it prefixes `/api/v1`, pass `/auth/staff/password`. Follow its callers.

**Error texts:** bilingual, in the same style as `ERROR_TEXT` in `native-login-form.tsx`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm.cmd --filter admin-web run test`
Run: `pnpm.cmd --filter admin-web run typecheck`
Run: `pnpm.cmd --filter admin-web run lint`
Expected: PASS, exit 0, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): add forgot, reset and change password pages"
```

---

### Task 7: Docs, gaps, gates, push

- [ ] **Step 1: README**

Add a section "Email and password reset (Plan 1C)" to `infrastructure/railway/README.md`.

**API variables:**

| Variable           | Value                        |
| ------------------ | ---------------------------- |
| `RESEND_API_KEY`   | secret                       |
| `EMAIL_FROM`       | default sandbox sender       |
| `ADMIN_PUBLIC_URL` | `https://<admin-web domain>` |

**Notes:**

- Resend's sandbox sender (`onboarding@resend.dev`) delivers **only to the email address the Resend account was created with**. That is enough for the owner's own password reset.
- Customer emails need a verified sending domain, which requires buying a domain.

- [ ] **Step 2: Gaps**

- **G-49:** narrowed. The staff reset email and the customer signup email go through Resend. Order and shipping emails are still stubs.
- **G-72:** closed when `RESEND_API_KEY` is set.
- Add **open, Low**: "expired/used reset tokens are never deleted (needs a retention job)."

- [ ] **Step 3: Gates, sequentially**

Run each, in order:

- `pnpm.cmd --filter @platform/security run test`
- `pnpm.cmd --filter @platform/auth run test`
- `pnpm.cmd --filter @platform/admin run test`
- `pnpm.cmd --filter @platform/runtime run test`
- `pnpm.cmd --filter admin-web run test`
- `pnpm.cmd --filter @platform/db run test`

Then:

- `pnpm.cmd -r --no-bail run typecheck`
- `pnpm.cmd -r --no-bail run lint`
- `pnpm.cmd arch`

Expected: every one exits 0, with no new warnings. The `tenant-mode-guard` classification test must pass. If a new `TENANT_DEFAULT_ID` read was added anywhere, stop and report. Use `nativeTenantId()` instead.

- [ ] **Step 4: Commit and push**

```bash
git add infrastructure/railway/README.md docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-07-email-and-password-reset.md
git commit -m "docs(auth): document email sending and staff password reset"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- With `RESEND_API_KEY` and `ADMIN_PUBLIC_URL` set:
  - "Forgot password?" on the login form emails a link;
  - the link sets a new password once, within 30 minutes;
  - the old password stops working.
- An unknown email gets exactly the same response, and no email is sent.
- The request endpoint is rate-limited.
- A signed-in staff member can change their password with the current one.
- Only SHA-256 of a reset token is stored. No token, link, password, key or email body appears in any log.
- Without the new variables, nothing changes: emails go to the log (recipient and subject only).

## Stop conditions (stop and report in Arabic)

- Any existing test outside the listed files fails.
- The `prisma-tenant-where` guard or the `tenant-mode-guard` classification test fails.
- `mutateAdminApi` cannot reach `/auth/staff/password` with the session token.

## Owner steps after merge (not for agents)

1. Railway → API Console: `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`. Expect `20261007000000_security_password_reset_tokens`.
2. Create a free Resend account **with the same email you sign in with**, then create an API key.

   Copy the key from Resend's website and paste it straight into Railway Variables. **Never paste it in chat.**

3. Set on the API:
   - `RESEND_API_KEY`;
   - `ADMIN_PUBLIC_URL=https://<admin-web domain>`.

   Then Deploy.

4. On the login page, click "نسيت كلمة السر؟" and check your inbox.
