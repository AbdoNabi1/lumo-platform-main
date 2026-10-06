# Native Staff Sign-in (Plan 1B-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الخطة دي بتخلّي التاجر يدخل لوحة التحكم **من غير Ory**.
>
> - السيرفر بتاعنا هو اللي بيتأكد من الإيميل والباسورد، وبعدين بيطلّع "تذكرة دخول" متوقّعة بمفتاح خاص بينا.
> - الصلاحيات بقت جدول بسيط بتلات أدوار: **أدمن** (كل حاجة)، **مشغّل** (منتجات وطلبات ومخزون)، **مشاهد** (قراءة بس)، زي شوبيفاي.
> - بتصلّح كمان ثغرة التشفير G-87.
>
> كل ده **مقفول بمفتاح** (`AUTH_MODE`). طول ما المفتاح ما اتغيّرش، Ory يفضل شغّال زي ما هو. إنت بتقلب المفتاح بنفسك لما تكون جاهز، بالخطوات اللي في آخر الملف.

**Goal:** Staff sign in to the merchant dashboard with email and password checked by our own Security context. The runtime signs its own JWTs (ES256) and publishes its JWKS. Authorization comes from a fixed three-role table instead of Ory Keto. All of it sits behind `AUTH_MODE=native`; the default `ory` changes nothing.

**Architecture:**

- **Tokens.** `packages/auth` gains a `NativeTokenIssuer` (jose, ES256, key from env) and a `RoleTableAccessControl` (pure; maps the `roles` claim to permission patterns).
- **Role lookup.** Security gains one read use case, `ListPrincipalRoleKeys`.
- **Login.** `apps/admin` gains:
  - `StaffAuthAdminController`, which authenticates through the Plan 1B-1 password provider (identifier namespaced `staff:<email>`, so a merchant's customer account and staff account never collide), lists the role keys, and mints a token;
  - two public routes: login and JWKS;
  - an idempotent owner bootstrap from env.
- **Runtime.** `AUTH_MODE` selects the authenticator (Ory JWKS, or our local key) and the access control (Keto, or the role table).
- **Dashboard.** admin-web shows a plain email/password form in native mode and stores the token in the same `morbeh_admin_session` cookie it already verifies. Because the cookie is set by admin-web on its own host, the shared-cookie-domain problem (`up.railway.app` is on the Public Suffix List) disappears.

**Tech Stack:** TypeScript, vitest, `jose` ^5 (already a dependency of `@platform/auth` and admin-web), `node:crypto`, Next.js 15 route handlers.

**Spec:**

- [PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 0, unit 2 "Identity".
- [PLATFORM-GAP-REVIEW.md](../../plans/PLATFORM-GAP-REVIEW.md): §2.8.
- Gap G-87 (open).
- Builds on Plan 1B-1 (`HashedPasswordAuthProvider`, `passwordRegistrar`).

## Global Constraints

Same as Plans 1A and 1B-1.

### Git and branch

- Branch `morbeh/w0-w17-w12`. Never force-push. Never `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit subjects lowercase, each line at most 100 characters.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **Never set `TENANT_MODE=multi`** in any env file, example, manifest or CI config.
- **No database connection.** This plan adds no migration.

### Secrets

- **Never print, log or commit a private key, password, token or `MFA_TOTP_KEY`.**
- Tests generate throwaway keys in memory with `generateKeyPairSync`. Never write a key file to disk.

### Defaults

- **`AUTH_MODE` defaults to `ory`.** With it unset, every existing test and the live deployment behave exactly as today.
- Token lifetime defaults to **7200 s**.

### Windows host and commands

- Use per-package commands:
  - `pnpm.cmd --filter <pkg> run test`
  - `pnpm.cmd --filter <pkg> run typecheck`
- Never run a full typecheck and a full test suite at the same time.
- No Python, no `gh`.
- Package filters:

| Directory           | Package filter       |
| ------------------- | -------------------- |
| `packages/auth`     | `@platform/auth`     |
| `services/security` | `@platform/security` |
| `apps/admin`        | `@platform/admin`    |
| `apps/runtime`      | `@platform/runtime`  |
| `apps/admin-web`    | `admin-web`          |

### Lint

- No new lint warnings. In particular, no `async` function without `await` (`require-await`). Return `Promise.resolve(...)` instead, as Plan 1B-1 did.

---

## File Structure

### `packages/auth/src/`

- **`native-token-issuer.ts`** (new), with `native-token-issuer.test.ts`:
  - `loadSigningKey(raw)`, which accepts PEM, or base64 of the PEM;
  - `NativeTokenIssuer`, with `issue` and `jwks`;
  - `localKeyResolver`, which returns a `getKey` for `JwtVerifier`.
- **`role-table-access-control.ts`** (new), with `role-table-access-control.test.ts`: `ROLE_PERMISSIONS`, `permissionMatches`, `RoleTableAccessControl`.
- **`index.ts`** (modify): exports.

### `services/security/src/`

- **`application/principal-roles.use-cases.ts`** (new), with `principal-roles.use-cases.test.ts`: `ListPrincipalRoleKeys`.
- **`interfaces/security.controller.ts`** (modify), **`composition.ts`** (modify), **`index.ts`** (modify).
- **`infrastructure/totp-mfa-provider.ts`** (modify): `keyRef` constructor option (G-87).
- **`infrastructure/totp-mfa-provider.key-ref.test.ts`** (new).

### `apps/admin/src/`

- **`interfaces/staff-auth.admin-controller.ts`** (new): login and JWKS.
- **`http/public-staff-auth-routes.ts`** (new), with `public-staff-auth-routes.test.ts`.
- **`staff-owner-bootstrap.ts`** (new), with `staff-owner-bootstrap.test.ts`.
- **`composition.ts`** (modify): `AdminWiringDeps.staffTokenIssuer?` and `WiredAdmin.staffAuth`.
- **`http/admin-routes.ts`** (modify): mount the new routes.
- **`http/server.ts`** (modify): `AdminHttpDeps.bootstrapOwner?`.

### `apps/runtime/src/`

- **`config.ts`** (modify): `AUTH_MODE`, `AUTH_SIGNING_KEY`, `STAFF_TOKEN_TTL_SECONDS`, `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`, `MFA_TOTP_KEY`; refinements.
- **`config.native-auth.test.ts`** (new).
- **`composition.ts`** (modify): authenticator, access control and TOTP key by mode.
- **`api.ts`** (modify): passes the issuer and the owner bootstrap.

### `apps/admin-web/src/`

- **`lib/auth/native.ts`** (new), with `native.test.ts`: `isNativeAuth`, `jwksFetchHeaders`, `exchangePassword`.
- **`app/auth/native-login/route.ts`** (new): POST that sets the session cookie.
- **`app/login/page.tsx`** (modify): native form branch.
- **`middleware.ts`** (modify): native redirect branch, plus JWKS headers.
- **`lib/auth/session.ts`** (modify): JWKS headers.

### Docs

- `infrastructure/railway/README.md`, `docs/KNOWN_GAPS.md`, `docs/architecture/23-platform-gap-register.md`.

---

### Task 1: TOTP secrets encrypted under a real key (closes G-87)

**Files:**

- Modify: `services/security/src/infrastructure/totp-mfa-provider.ts` (`KEY_REF` at line 7, used at lines 32 and 54)
- Test: `services/security/src/infrastructure/totp-mfa-provider.key-ref.test.ts`

**Interfaces:**

- Produces: `new TotpMfaProvider(crypto, clock, options?: { keyRef?: string })`. When given, `keyRef` must be at least 32 characters, or the constructor throws. When absent, it falls back to the legacy constant, for local and tests only. Task 7 makes the runtime pass it.

- [ ] **Step 1: Write the failing test**

```ts
// services/security/src/infrastructure/totp-mfa-provider.key-ref.test.ts
import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { NodeCrypto } from "./in-memory-auth-adapters";
import { TotpMfaProvider } from "./totp-mfa-provider";

const clock: Clock = { now: () => new Date("2026-10-07T00:00:00.000Z") };
const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);

describe("TotpMfaProvider keyRef (G-87)", () => {
  it("encrypts the secret under the configured key, not the source-code constant", async () => {
    const crypto = new NodeCrypto();
    const provider = new TotpMfaProvider(crypto, clock, { keyRef: KEY_A });
    const { secretRef } = await provider.enroll({ principalRef: "p-1" });
    await expect(crypto.decrypt(secretRef, KEY_A)).resolves.toMatch(/^[A-Z2-7]+$/);
    await expect(crypto.decrypt(secretRef, KEY_B)).rejects.toThrow();
    await expect(crypto.decrypt(secretRef, "security.mfa.totp")).rejects.toThrow();
  });

  it("refuses a short key", () => {
    expect(() => new TotpMfaProvider(new NodeCrypto(), clock, { keyRef: "short" })).toThrow(/32/);
  });
});
```

> If `NodeCrypto` is not exported from `./in-memory-auth-adapters` under that name, import it from wherever `apps/runtime/src/composition.ts` gets it (`@platform/security`'s index re-exports it).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/security run test -- totp-mfa-provider.key-ref`
Expected: FAIL. The constructor ignores the third argument, so decrypt with `KEY_A` throws.

- [ ] **Step 3: Write the implementation**

In `totp-mfa-provider.ts`:

1. Rename `const KEY_REF = "security.mfa.totp";` to:

```ts
/** Legacy constant — local/tests only. Production passes `keyRef` from MFA_TOTP_KEY (G-87). */
const LEGACY_KEY_REF = "security.mfa.totp";
```

2. Change the constructor to take an options object as the third argument. Keep the existing parameter style of this file.

```ts
  private readonly keyRef: string;

  constructor(
    private readonly crypto: CryptoPort,
    private readonly clock: Clock,
    options: { readonly keyRef?: string } = {},
  ) {
    if (options.keyRef !== undefined && options.keyRef.length < 32) {
      throw new Error("TotpMfaProvider: keyRef must be at least 32 characters (G-87).");
    }
    this.keyRef = options.keyRef ?? LEGACY_KEY_REF;
  }
```

3. Replace both uses of `KEY_REF` (the `encrypt` at line ≈ 32 and the `decrypt` at line ≈ 54) with `this.keyRef`.

- [ ] **Step 4: Run the tests**

Run: `pnpm.cmd --filter @platform/security run test`
Expected: PASS, every existing test included.

- [ ] **Step 5: Commit**

```bash
git add services/security/src/infrastructure/totp-mfa-provider.ts services/security/src/infrastructure/totp-mfa-provider.key-ref.test.ts
git commit -m "fix(security): encrypt totp secrets under a configured key"
```

---

### Task 2: `NativeTokenIssuer`

**Files:**

- Create: `packages/auth/src/native-token-issuer.ts`
- Test: `packages/auth/src/native-token-issuer.test.ts`
- Modify: `packages/auth/src/index.ts`

**Interfaces:**

- Produces:

```ts
loadSigningKey(raw: string): KeyObject  // PEM, or base64 of PEM; EC P-256 only
class NativeTokenIssuer {
  constructor(opts: { privateKey: KeyObject; issuer: string; audience: string; ttlSeconds: number; now?: () => Date })
  issue(claims: { sub: string; tenantId: string; kind: "staff"; roles: readonly string[]; sid: string; email?: string }): Promise<{ token: string; expiresIn: number }>
  jwks(): Promise<{ keys: JWK[] }>
}
localKeyResolver(issuer: NativeTokenIssuer): Promise<JWTVerifyGetKey>  // for JwtVerifier({ getKey })
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/auth/src/native-token-issuer.test.ts
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JwtVerifier } from "./jwt-verifier";
import { NativeTokenIssuer, loadSigningKey, localKeyResolver } from "./native-token-issuer";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

function pem(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function issuer(raw = pem(), now = () => new Date()) {
  return new NativeTokenIssuer({
    privateKey: loadSigningKey(raw),
    issuer: "https://api.example.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
    now,
  });
}

describe("NativeTokenIssuer", () => {
  it("issues a token the existing JwtVerifier accepts, with roles, kind and tenant", async () => {
    const native = issuer();
    const { token, expiresIn } = await native.issue({
      sub: "staff-1",
      tenantId: "tenant-local",
      kind: "staff",
      roles: ["admin"],
      sid: "sess-1",
      email: "owner@example.test",
    });
    expect(expiresIn).toBe(7200);
    const verifier = new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(native),
      logger: silent,
    });
    const context = await verifier.verifyWithClaims(token);
    expect(context?.principal).toEqual({ id: "staff-1", kind: "staff", roles: ["admin"] });
    expect(context?.claims["tenant_id"]).toBe("tenant-local");
    expect(context?.claims["sid"]).toBe("sess-1");
  });

  it("publishes only the public key", async () => {
    const { keys } = await issuer().jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
    expect(typeof keys[0]?.kid).toBe("string");
  });

  it("a token from another key, or an expired one, is refused", async () => {
    const mine = issuer();
    const theirs = issuer();
    const verifier = new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(mine),
      logger: silent,
    });
    const forged = await theirs.issue({
      sub: "x",
      tenantId: "t",
      kind: "staff",
      roles: ["admin"],
      sid: "s",
    });
    expect(await verifier.verify(forged.token)).toBeNull();
    const old = issuer(pem(), () => new Date("2020-01-01T00:00:00Z"));
    const oldVerifier = new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(old),
      logger: silent,
    });
    const expired = await old.issue({
      sub: "x",
      tenantId: "t",
      kind: "staff",
      roles: [],
      sid: "s",
    });
    expect(await oldVerifier.verify(expired.token)).toBeNull();
  });

  it("loads a base64-wrapped PEM (single-line env var) and rejects non-P-256 keys", () => {
    const raw = pem();
    expect(() => loadSigningKey(Buffer.from(raw).toString("base64"))).not.toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() => loadSigningKey(rsa)).toThrow(/P-256/);
    expect(() => loadSigningKey("not a key")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/auth run test -- native-token-issuer`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/auth/src/native-token-issuer.ts
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import {
  SignJWT,
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";

/**
 * Plan 1B-2: loads the runtime's own signing key. Accepts a PKCS#8 PEM, or the same PEM base64-encoded
 * (one line — what a hosting dashboard's env field can hold). EC P-256 only (ES256).
 */
export function loadSigningKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  const pem = trimmed.startsWith("-----BEGIN")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8").trim();
  if (!pem.startsWith("-----BEGIN")) throw new Error("AUTH_SIGNING_KEY is not a PEM private key");
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("AUTH_SIGNING_KEY must be an EC P-256 private key (ES256)");
  }
  return key;
}

export interface NativeTokenIssuerOptions {
  readonly privateKey: KeyObject;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
  readonly now?: () => Date;
}

export interface NativeStaffClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly kind: "staff";
  readonly roles: readonly string[];
  readonly sid: string;
  readonly email?: string;
}

/**
 * Plan 1B-2: the platform's own token issuer (replaces Ory Hydra for staff sign-in). Claims match
 * what `JwtVerifier` and the HTTP pipeline already read: `sub`, `kind`, `roles`, `tenant_id`.
 */
export class NativeTokenIssuer {
  private readonly options: NativeTokenIssuerOptions;
  private readonly publicJwk: Promise<JWK>;

  constructor(options: NativeTokenIssuerOptions) {
    this.options = options;
    this.publicJwk = (async () => {
      const jwk = await exportJWK(createPublicKey(options.privateKey));
      const kid = await calculateJwkThumbprint(jwk);
      return { ...jwk, kid, alg: "ES256", use: "sig" };
    })();
  }

  async issue(claims: NativeStaffClaims): Promise<{ token: string; expiresIn: number }> {
    const { kid } = await this.publicJwk;
    const nowSeconds = Math.floor((this.options.now?.() ?? new Date()).getTime() / 1000);
    const token = await new SignJWT({
      kind: claims.kind,
      roles: [...claims.roles],
      tenant_id: claims.tenantId,
      sid: claims.sid,
      ...(claims.email === undefined ? {} : { email: claims.email }),
    })
      .setProtectedHeader({ alg: "ES256", ...(kid === undefined ? {} : { kid }) })
      .setSubject(claims.sub)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + this.options.ttlSeconds)
      .sign(this.options.privateKey);
    return { token, expiresIn: this.options.ttlSeconds };
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: [await this.publicJwk] };
  }
}

/** `getKey` for `JwtVerifier` that verifies against this issuer's own public key — no HTTP fetch. */
export async function localKeyResolver(issuer: NativeTokenIssuer): Promise<JWTVerifyGetKey> {
  return createLocalJWKSet(await issuer.jwks());
}
```

Add to `packages/auth/src/index.ts`:

```ts
export {
  NativeTokenIssuer,
  loadSigningKey,
  localKeyResolver,
  type NativeStaffClaims,
  type NativeTokenIssuerOptions,
} from "./native-token-issuer";
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/auth run test -- native-token-issuer`
Expected: PASS, 4 tests.

Run: `pnpm.cmd --filter @platform/auth run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/native-token-issuer.ts packages/auth/src/native-token-issuer.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): add the platform's own es256 token issuer"
```

---

### Task 3: `RoleTableAccessControl`

**Files:**

- Create: `packages/auth/src/role-table-access-control.ts`
- Test: `packages/auth/src/role-table-access-control.test.ts`
- Modify: `packages/auth/src/index.ts`

**Interfaces:**

- Produces:
  - `ROLE_PERMISSIONS: Readonly<Record<"admin" | "operator" | "viewer", readonly string[]>>`
  - `permissionMatches(granted, required): boolean`
  - `class RoleTableAccessControl implements AccessControl`

  `platform-admin`, the role key the existing tenant baseline assigns to a shop's owner, is treated as `admin`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/auth/src/role-table-access-control.test.ts
import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import { RoleTableAccessControl, permissionMatches } from "./role-table-access-control";

const who = (roles: string[]): Principal => ({ id: "s", kind: "staff", roles, tenantId: "t" });
const acl = new RoleTableAccessControl();

describe("permissionMatches", () => {
  it.each([
    ["*:*", "orders:refund", true],
    ["orders:*", "orders:refund", true],
    ["*:read", "finance:read", true],
    ["orders:read", "orders:read", true],
    ["orders:read", "orders:update", false],
    ["orders:*", "payments:refund", false],
    ["*:read", "orders:update", false],
  ])("%s grants %s → %s", (granted, required, expected) => {
    expect(permissionMatches(granted, required)).toBe(expected);
  });
});

describe("RoleTableAccessControl", () => {
  it("admin and platform-admin can do everything", async () => {
    expect(await acl.authorize(who(["admin"]), "security:manage")).toBe(true);
    expect(await acl.authorize(who(["platform-admin"]), "finance:create")).toBe(true);
  });

  it("operator runs the shop but cannot touch money, security or settings", async () => {
    const op = who(["operator"]);
    expect(await acl.authorize(op, "products:create")).toBe(true);
    expect(await acl.authorize(op, "orders:update")).toBe(true);
    expect(await acl.authorize(op, "inventory:reserve")).toBe(true);
    expect(await acl.authorize(op, "payments:refund")).toBe(false);
    expect(await acl.authorize(op, "security:manage")).toBe(false);
    expect(await acl.authorize(op, "finance:read")).toBe(false);
    expect(await acl.authorize(op, "tenancy:update")).toBe(false);
  });

  it("viewer only reads shop data", async () => {
    const viewer = who(["viewer"]);
    expect(await acl.authorize(viewer, "orders:read")).toBe(true);
    expect(await acl.authorize(viewer, "orders:update")).toBe(false);
    expect(await acl.authorize(viewer, "finance:read")).toBe(false);
  });

  it("no role, an unknown role, or a customer gets nothing", async () => {
    expect(await acl.authorize(who([]), "orders:read")).toBe(false);
    expect(await acl.authorize(who(["superuser"]), "orders:read")).toBe(false);
    expect(
      await acl.authorize(
        { id: "c", kind: "customer", roles: ["admin"], tenantId: "t" },
        "orders:read",
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/auth run test -- role-table-access-control`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/auth/src/role-table-access-control.ts
import type { AccessControl, Permission, Principal } from "@platform/contracts";

/** Shop-data resources a viewer may read and an operator may change (Plan 1B-2). */
const SHOP_RESOURCES = [
  "products",
  "categories",
  "brands",
  "collections",
  "inventory",
  "warehouse",
  "pricing",
  "orders",
  "fulfillment",
  "shipping",
  "returns",
  "customers",
  "reviews",
  "promotions",
  "coupons",
  "media_library",
  "pages",
  "content",
  "components",
  "theme",
  "experience",
  "seo",
  "localization",
  "notifications",
] as const;

/** Read-only extras a viewer and operator may see (dashboards), never change. */
const READ_ONLY_RESOURCES = ["analytics", "reporting", "search", "recommendations"] as const;

/**
 * Plan 1B-2: Shopify-style fixed staff roles. Money (payments, finance), security, tenancy, billing
 * and feature administration stay admin-only. Granular per-staff permissions are a later plan.
 */
export const ROLE_PERMISSIONS = {
  admin: ["*:*"],
  operator: [
    ...SHOP_RESOURCES.map((r) => `${r}:*`),
    ...READ_ONLY_RESOURCES.map((r) => `${r}:read`),
  ],
  viewer: [...SHOP_RESOURCES, ...READ_ONLY_RESOURCES].map((r) => `${r}:read`),
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** The tenant baseline's owner role (services/security tenant-baseline.ts) is an admin. */
const ROLE_ALIASES: Readonly<Record<string, keyof typeof ROLE_PERMISSIONS>> = {
  "platform-admin": "admin",
  admin: "admin",
  operator: "operator",
  viewer: "viewer",
};

export function permissionMatches(granted: string, required: string): boolean {
  const [gResource, gAction] = granted.split(":");
  const [rResource, rAction] = required.split(":");
  if (gResource === undefined || gAction === undefined) return false;
  if (rResource === undefined || rAction === undefined) return false;
  return (gResource === "*" || gResource === rResource) && (gAction === "*" || gAction === rAction);
}

/** `AccessControl` over the role table. Only staff principals are considered. */
export class RoleTableAccessControl implements AccessControl {
  authorize(principal: Principal, permission: Permission): Promise<boolean> {
    if (principal.kind !== "staff") return Promise.resolve(false);
    const allowed = principal.roles.some((role) => {
      const canonical = ROLE_ALIASES[role];
      return (
        canonical !== undefined &&
        ROLE_PERMISSIONS[canonical].some((granted) => permissionMatches(granted, permission))
      );
    });
    return Promise.resolve(allowed);
  }
}
```

Add to `packages/auth/src/index.ts`:

```ts
export {
  ROLE_PERMISSIONS,
  RoleTableAccessControl,
  permissionMatches,
} from "./role-table-access-control";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm.cmd --filter @platform/auth run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/role-table-access-control.ts packages/auth/src/role-table-access-control.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): add a fixed staff role table access control"
```

---

### Task 4: `ListPrincipalRoleKeys` in Security

**Files:**

- Create: `services/security/src/application/principal-roles.use-cases.ts`
- Test: `services/security/src/application/principal-roles.use-cases.test.ts`
- Modify:
  - `services/security/src/interfaces/security.controller.ts`: deps field next to `evaluateAccess` (line ≈ 220); method next to `evaluateAccess` (line ≈ 370).
  - `services/security/src/composition.ts`: construct next to `const evaluateAccess = …` (line ≈ 583); pass it in the controller deps (line ≈ 650).

**Interfaces:**

- Produces:
  - `ListPrincipalRoleKeys`, which takes `{ tenantId, principalExternalId }` and returns `{ roleKeys: string[] }`. Only assignments active now count. An unknown principal returns `[]`.
  - `SecurityController.listPrincipalRoleKeys(input)`, which returns 200.

- [ ] **Step 1: Write the failing test**

Wire through `wireSecurity` the same way `password-provider-injection.test.ts` (Plan 1B-1) does, then:

```ts
// services/security/src/application/principal-roles.use-cases.test.ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "../composition";

const clock: Clock = { now: () => new Date("2026-10-07T00:00:00.000Z") };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: ["staff-1"],
  });
}

describe("ListPrincipalRoleKeys (Plan 1B-2)", () => {
  it("lists the principal's active role keys; unknown principals have none", async () => {
    const { security } = wire();
    await security.defineRole({
      tenantId: "t",
      key: "operator",
      name: "Operator",
      permissions: ["orders:*"],
    });
    await security.registerPrincipal({
      tenantId: "t",
      externalId: "staff-1",
      kind: "human",
      displayName: "staff-1",
      subjectRef: "staff-1",
    });
    await security.assignRole({
      tenantId: "t",
      principalExternalId: "staff-1",
      roleKey: "operator",
      grantedBy: "test",
    });
    const listed = await security.listPrincipalRoleKeys({
      tenantId: "t",
      principalExternalId: "staff-1",
    });
    expect(listed).toEqual({ status: 200, body: { roleKeys: ["operator"] } });
    const unknown = await security.listPrincipalRoleKeys({
      tenantId: "t",
      principalExternalId: "nobody",
    });
    expect(unknown.body).toEqual({ roleKeys: [] });
  });

  it("does not leak another tenant's assignments", async () => {
    const { security } = wire();
    await security.defineRole({
      tenantId: "t",
      key: "operator",
      name: "Operator",
      permissions: ["orders:*"],
    });
    await security.registerPrincipal({
      tenantId: "t",
      externalId: "staff-1",
      kind: "human",
      displayName: "s",
      subjectRef: "staff-1",
    });
    await security.assignRole({
      tenantId: "t",
      principalExternalId: "staff-1",
      roleKey: "operator",
      grantedBy: "test",
    });
    const other = await security.listPrincipalRoleKeys({
      tenantId: "other",
      principalExternalId: "staff-1",
    });
    expect(other.body).toEqual({ roleKeys: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/security run test -- principal-roles`
Expected: FAIL, `listPrincipalRoleKeys is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
// services/security/src/application/principal-roles.use-cases.ts
import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SecurityDeps } from "./deps";

export interface ListPrincipalRoleKeysInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
}

/**
 * Plan 1B-2: the role keys a principal holds right now, for minting a staff token. Read-only, no
 * audit record (unlike EvaluateAccess), tenant-scoped like every Security read.
 */
export class ListPrincipalRoleKeys implements UseCase<
  ListPrincipalRoleKeysInput,
  { readonly roleKeys: readonly string[] },
  DomainError
> {
  private readonly deps: SecurityDeps;

  constructor(deps: SecurityDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListPrincipalRoleKeysInput,
  ): Promise<Result<{ readonly roleKeys: readonly string[] }, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return ok({ roleKeys: [] });
    const now = this.deps.clock.now();
    const assignments = await this.deps.assignments.listByPrincipal(
      principal.id.toString(),
      input.tenantId,
    );
    const roleKeys = [
      ...new Set(assignments.filter((a) => a.isActiveAt(now)).map((a) => a.roleKey)),
    ].sort();
    return ok({ roleKeys });
  }
}
```

Controller:

- Add the deps field `readonly listPrincipalRoleKeys: ListPrincipalRoleKeys;`.
- Add the method:

```ts
  async listPrincipalRoleKeys(input: ListPrincipalRoleKeysInput): Promise<ControllerResponse> {
    return present(await this.deps.listPrincipalRoleKeys.execute(input), 200);
  }
```

Composition:

- `const listPrincipalRoleKeys = new ListPrincipalRoleKeys(securityDeps);`
- Add `listPrincipalRoleKeys,` to the controller deps object.

Export the use case and input type from `index.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/security run test`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/security run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/security/src/application/principal-roles.use-cases.ts services/security/src/application/principal-roles.use-cases.test.ts services/security/src/interfaces/security.controller.ts services/security/src/composition.ts services/security/src/index.ts
git commit -m "feat(security): list a principal's active role keys"
```

---

### Task 5: Staff login and JWKS routes

**Files:**

- Create: `apps/admin/src/interfaces/staff-auth.admin-controller.ts`
- Create: `apps/admin/src/http/public-staff-auth-routes.ts`
- Test: `apps/admin/src/http/public-staff-auth-routes.test.ts`
- Modify: `apps/admin/src/composition.ts`
  - `AdminWiringDeps`: add `staffTokenIssuer?: NativeTokenIssuer`.
  - `WiredAdmin`: add `staffAuth`, next to `customerAuth` at line ≈ 479 and line ≈ 1051.
- Modify: `apps/admin/src/http/admin-routes.ts`: spread `...publicStaffAuthRoutes(admin, options.rateLimiter),` next to `...publicAuthRoutes(...)` (line ≈ 1868).

**Interfaces:**

- Consumes:
  - `security.authenticate`, `security.introspectSessionSubject`, `security.listPrincipalRoleKeys`
  - `security.registerAuthMethod` (existing)
  - `NativeTokenIssuer` (Task 2)
- Produces:
  - `STAFF_IDENTIFIER_PREFIX = "staff:"`
  - `staffIdentifier(email)`
  - `StaffAuthAdminController.login({ tenantId, email, password })`
  - `StaffAuthAdminController.jwks()`
- Routes:

| Method | Path                       | Response                                          |
| ------ | -------------------------- | ------------------------------------------------- |
| `POST` | `/public/auth/staff/login` | `{ accessToken, tokenType: "Bearer", expiresIn }` |
| `GET`  | `/public/auth/jwks`        | `{ keys }`                                        |

Both routes are `public: true` with permission `security:authenticate`.

- Login statuses:
  - 401 for bad credentials, or for a principal with no staff role;
  - 403 `MFA_REQUIRED`;
  - 503 when no issuer is configured.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/http/public-staff-auth-routes.test.ts
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { JwtVerifier, NativeTokenIssuer, localKeyResolver } from "@platform/auth";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { staffIdentifier } from "../interfaces/staff-auth.admin-controller";
import { publicStaffAuthRoutes } from "./public-staff-auth-routes";

const clock: Clock = { now: () => new Date() };
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

function issuer() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
  });
}

async function setup(withIssuer = true) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const native = issuer();
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    ...(withIssuer ? { staffTokenIssuer: native } : {}),
  });
  return { admin, native, routes: publicStaffAuthRoutes(admin) };
}

/** Seeds a staff member straight through Security, the way the owner bootstrap (Task 6) will. */
async function seedStaff(admin: WiredAdmin, roleKey: string | null) {
  const tenantId = "tenant-local";
  admin.securityWiring.identityDirectory.register("staff-1");
  await admin.securityWiring.security.registerPrincipal({
    tenantId,
    externalId: "staff-1",
    kind: "human",
    displayName: "owner@example.test",
    subjectRef: "staff-1",
  });
  await admin.securityWiring.passwordRegistrar.setPassword({
    tenantId,
    identifier: staffIdentifier("owner@example.test"),
    password: "fake-password-1",
    principalExternalId: "staff-1",
  });
  if (roleKey !== null) {
    await admin.securityWiring.security.defineRole({
      tenantId,
      key: roleKey,
      name: roleKey,
      permissions: ["*:*"],
    });
    await admin.securityWiring.security.assignRole({
      tenantId,
      principalExternalId: "staff-1",
      roleKey,
      grantedBy: "test",
    });
  }
}

const find = (routes: readonly RouteDefinition[], method: string, path: string) => {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`no route ${method} ${path}`);
  return r;
};
const call = (r: RouteDefinition, body?: unknown) =>
  r.handle({
    body,
    params: {},
    query: {},
    context: {
      tenantId: "tenant-local",
      principal: { id: "anonymous", kind: "customer", roles: [], tenantId: "tenant-local" },
      requestId: "r",
    },
  } as never) as Promise<{ status: number; body: unknown }>;

describe("staff sign-in (Plan 1B-2)", () => {
  it("an owner signs in and gets a token the runtime's verifier accepts as an admin of this shop", async () => {
    const { admin, native, routes } = await setup();
    await seedStaff(admin, "platform-admin");
    const res = await call(find(routes, "POST", "/public/auth/staff/login"), {
      email: "Owner@Example.test",
      password: "fake-password-1",
    });
    expect(res.status).toBe(200);
    const body = res.body as { accessToken: string; tokenType: string; expiresIn: number };
    expect(body.tokenType).toBe("Bearer");
    const verifier = new JwtVerifier({
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(native),
      logger: silent,
    });
    const ctx = await verifier.verifyWithClaims(body.accessToken);
    expect(ctx?.principal).toEqual({ id: "staff-1", kind: "staff", roles: ["admin"] });
    expect(ctx?.claims["tenant_id"]).toBe("tenant-local");
  });

  it("wrong password → 401; a principal with no staff role → 401", async () => {
    const { admin, routes } = await setup();
    await seedStaff(admin, null);
    const login = find(routes, "POST", "/public/auth/staff/login");
    expect(
      (await call(login, { email: "owner@example.test", password: "wrong-password" })).status,
    ).toBe(401);
    expect(
      (await call(login, { email: "owner@example.test", password: "fake-password-1" })).status,
    ).toBe(401);
  });

  it("a customer's credentials never work on the staff login (separate identifier namespace)", async () => {
    const { admin, routes } = await setup();
    await admin.securityWiring.passwordRegistrar.setPassword({
      tenantId: "tenant-local",
      identifier: "owner@example.test",
      password: "fake-password-1",
      principalExternalId: "customer-1",
    });
    const res = await call(find(routes, "POST", "/public/auth/staff/login"), {
      email: "owner@example.test",
      password: "fake-password-1",
    });
    expect(res.status).toBe(401);
  });

  it("JWKS publishes the public key; with no issuer configured both routes answer 503", async () => {
    const { routes } = await setup();
    const jwks = await call(find(routes, "GET", "/public/auth/jwks"));
    expect((jwks.body as { keys: unknown[] }).keys).toHaveLength(1);
    const off = await setup(false);
    expect((await call(find(off.routes, "GET", "/public/auth/jwks"))).status).toBe(503);
    expect(
      (
        await call(find(off.routes, "POST", "/public/auth/staff/login"), {
          email: "a@b.c",
          password: "fake-password-1",
        })
      ).status,
    ).toBe(503);
  });
});
```

> **WiredAdmin exposure (do this in this task).** The existing `security: SecurityController` near composition.ts line ≈ 554 is the
> raw _controller_ inside the public-reads slice; it is not the whole `WiredSecurity`. Add a NEW top-level field to `WiredAdmin`:
> `readonly securityWiring: Pick<WiredSecurity, "security" | "identityDirectory" | "passwordRegistrar">;` and set
> `securityWiring: security,` in the returned object (`security` there is the `wireSecurity(deps)` result, line ≈ 824).
> Import `type WiredSecurity` from `@platform/security`. The test and the owner bootstrap (Task 6) use `admin.securityWiring`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- public-staff-auth-routes`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/interfaces/staff-auth.admin-controller.ts
import type { NativeTokenIssuer } from "@platform/auth";
import type { SecurityController } from "@platform/security";
import type { AdminResponse } from "./admin-response";

/** Staff logins live in their own identifier namespace so a shop's customer and staff never collide. */
export const STAFF_IDENTIFIER_PREFIX = "staff:";

export function staffIdentifier(email: string): string {
  return `${STAFF_IDENTIFIER_PREFIX}${email.trim().toLowerCase()}`;
}

/** Security's baseline owner role and the dashboard's three roles (packages/auth RoleTableAccessControl). */
const TOKEN_ROLE: Readonly<Record<string, string>> = {
  "platform-admin": "admin",
  admin: "admin",
  operator: "operator",
  viewer: "viewer",
};

const UNAUTHENTICATED: AdminResponse = {
  status: 401,
  body: { error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } },
};
const NOT_CONFIGURED: AdminResponse = {
  status: 503,
  body: { error: { code: "NOT_CONFIGURED", message: "Native staff sign-in is not configured" } },
};

export interface StaffAuthAdminControllerDeps {
  readonly security: SecurityController;
  readonly issuer?: NativeTokenIssuer;
  readonly sessionTtlSeconds: number;
}

/** Plan 1B-2: native staff sign-in — password (Plan 1B-1 provider) → session → role keys → token. */
export class StaffAuthAdminController {
  private readonly deps: StaffAuthAdminControllerDeps;
  private passwordMethodReady: Promise<void> | undefined;

  constructor(deps: StaffAuthAdminControllerDeps) {
    this.deps = deps;
  }

  async login(input: {
    readonly tenantId: string;
    readonly email: string;
    readonly password: string;
  }): Promise<AdminResponse> {
    const issuer = this.deps.issuer;
    if (issuer === undefined) return NOT_CONFIGURED;
    await this.ensurePasswordMethod(input.tenantId);
    const outcome = await this.deps.security.authenticate({
      tenantId: input.tenantId,
      method: "password",
      identifier: staffIdentifier(input.email),
      credential: input.password,
      sessionTtlSeconds: this.deps.sessionTtlSeconds,
    });
    if (outcome.status < 200 || outcome.status >= 300) return UNAUTHENTICATED;
    const result = outcome.body as {
      readonly authenticated: boolean;
      readonly sessionId: string | null;
      readonly mfaRequirement: string;
    };
    if (result.authenticated && result.sessionId === null) {
      return {
        status: 403,
        body: {
          error: {
            code: "MFA_REQUIRED",
            message: "An additional authentication factor is required",
          },
          mfaRequirement: result.mfaRequirement,
        },
      };
    }
    if (!result.authenticated || result.sessionId === null) return UNAUTHENTICATED;

    const subject = await this.deps.security.introspectSessionSubject({
      tenantId: input.tenantId,
      sessionId: result.sessionId,
    });
    const principalExternalId = (subject.body as { principalExternalId: string | null })
      .principalExternalId;
    if (principalExternalId === null) return UNAUTHENTICATED;

    const listed = await this.deps.security.listPrincipalRoleKeys({
      tenantId: input.tenantId,
      principalExternalId,
    });
    const roles = [
      ...new Set(
        ((listed.body as { roleKeys?: readonly string[] }).roleKeys ?? [])
          .map((key) => TOKEN_ROLE[key])
          .filter((role): role is string => role !== undefined),
      ),
    ];
    if (roles.length === 0) return UNAUTHENTICATED; // a customer, or staff with no role yet

    const { token, expiresIn } = await issuer.issue({
      sub: principalExternalId,
      tenantId: input.tenantId,
      kind: "staff",
      roles,
      sid: result.sessionId,
      email: input.email.trim().toLowerCase(),
    });
    return { status: 200, body: { accessToken: token, tokenType: "Bearer", expiresIn } };
  }

  async jwks(): Promise<AdminResponse> {
    if (this.deps.issuer === undefined) return NOT_CONFIGURED;
    return { status: 200, body: await this.deps.issuer.jwks() };
  }

  private ensurePasswordMethod(tenantId: string): Promise<void> {
    this.passwordMethodReady ??= (async () => {
      const authMethods = this.deps.security
        .registryExplorer()
        .registries.find((registry) => registry.name === "auth-methods");
      if (authMethods?.entries.some((entry) => entry.key === "password") ?? false) return;
      await this.deps.security.registerAuthMethod({
        tenantId,
        kind: "password",
        displayName: "Password",
      });
    })();
    return this.passwordMethodReady;
  }
}
```

> `AdminResponse`'s import path: use whatever `customer-auth.admin-controller.ts` imports it from. The `ensurePasswordMethod` body is the same logic as `CustomerAuthAdminController.ensurePasswordMethod` (≈ line 93). Copying it keeps this task from touching the customer controller. Extracting a shared helper is a later cleanup.

```ts
// apps/admin/src/http/public-staff-auth-routes.ts
import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const staffLoginBody = z
  .object({
    email: z.string().min(3).max(320),
    password: z.string().min(1).max(256),
  })
  .strict();

/**
 * Plan 1B-2: native staff sign-in. Public (no principal yet) but tenant-resolved like every route.
 * NOT idempotent, for the same reason as the customer `/public/auth/login`: a replayed login response
 * would hand a second caller the first caller's token.
 */
export function publicStaffAuthRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/auth/staff/login",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: sign a staff member in with email and password (native auth)",
      schema: { body: staffLoginBody },
      handle: ({ body, context }) =>
        admin.staffAuth.login({
          tenantId: context.tenantId,
          email: body.email,
          password: body.password,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/public/auth/jwks",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: the platform token issuer's public keys (JWKS)",
      handle: () => admin.staffAuth.jwks(),
    }),
  ];
}
```

> The customer login route takes `rateLimiter` for a per-identifier limit. Open `public-auth-routes.ts` and apply the **same** limiter wrapping to the staff login route, keyed `staff-login:<tenant>:<email>`. If the customer route uses a helper, call that helper. Then change the signature to `publicStaffAuthRoutes(admin, rateLimiter?)` and mount it as `...publicStaffAuthRoutes(admin, options.rateLimiter)`.

In `composition.ts`:

- Import `type NativeTokenIssuer` from `@platform/auth`.
- Add to `AdminWiringDeps`:

```ts
  /** Plan 1B-2: the platform's own token issuer; absent ⇒ staff login/JWKS answer 503. */
  readonly staffTokenIssuer?: NativeTokenIssuer;
  /** Plan 1B-2: staff session/token lifetime in seconds (default 7200). */
  readonly staffTokenTtlSeconds?: number;
```

- In `WiredAdmin` add `readonly staffAuth: StaffAuthAdminController;`, and in the returned object, next to `customerAuth`:

```ts
    staffAuth: new StaffAuthAdminController({
      security: security.security,
      ...(deps.staffTokenIssuer === undefined ? {} : { issuer: deps.staffTokenIssuer }),
      sessionTtlSeconds: deps.staffTokenTtlSeconds ?? 7200,
    }),
```

- If `@platform/auth` is not yet a dependency of `@platform/admin`, add `"@platform/auth": "workspace:*"` and run `pnpm.cmd install`. Then run `pnpm.cmd arch` to confirm that apps importing packages is allowed (it is for `@platform/security`).

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/admin run test -- public-staff-auth-routes public-auth-routes`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/interfaces/staff-auth.admin-controller.ts apps/admin/src/http/public-staff-auth-routes.ts apps/admin/src/http/public-staff-auth-routes.test.ts apps/admin/src/composition.ts apps/admin/src/http/admin-routes.ts apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): add native staff login and jwks routes"
```

---

### Task 6: Owner bootstrap

**Files:**

- Create: `apps/admin/src/staff-owner-bootstrap.ts`
- Test: `apps/admin/src/staff-owner-bootstrap.test.ts`
- Modify: `apps/admin/src/http/server.ts`
  - `AdminHttpDeps` gains `bootstrapOwner?: { email: string; password: string }`.
  - Call the bootstrap in `createAdminHttpApi` right after `const admin = wireAdmin({...})`.

**Interfaces:**

- Produces: `bootstrapStaffOwner(admin, { tenantId, email, password, logger })`, which returns `Promise<"created" | "exists">`. It is idempotent: if `staff:<email>` already has a credential in the tenant, it does nothing.

  On create it:
  1. runs `bootstrapSecurity(security, tenantId, logger)` (idempotent; it guarantees the `platform-admin` role exists);
  2. registers the subject and a human principal with a fresh UUID;
  3. sets the password;
  4. assigns `platform-admin` with `grantedBy: SYSTEM_GRANTOR`.

  It never logs the password.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/staff-owner-bootstrap.test.ts
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { NativeTokenIssuer } from "@platform/auth";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { wireAdmin } from "./composition";
import { bootstrapStaffOwner } from "./staff-owner-bootstrap";

const clock: Clock = { now: () => new Date() };

function build() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const lines: string[] = [];
  const logger = {
    debug: () => {},
    info: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    warn: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    error: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
  } as never;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const admin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: new NativeTokenIssuer({
      privateKey,
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      ttlSeconds: 7200,
    }),
  });
  return { admin, logger, lines };
}

describe("bootstrapStaffOwner (Plan 1B-2)", () => {
  it("creates the owner once, who can then sign in as admin; never logs the password", async () => {
    const { admin, logger, lines } = build();
    const input = {
      tenantId: "tenant-local",
      email: "owner@example.test",
      password: "fake-owner-password",
      logger,
    };
    expect(await bootstrapStaffOwner(admin, input)).toBe("created");
    expect(await bootstrapStaffOwner(admin, { ...input, password: "another-fake-password" })).toBe(
      "exists",
    );
    const login = await admin.staffAuth.login({
      tenantId: "tenant-local",
      email: "owner@example.test",
      password: "fake-owner-password",
    });
    expect(login.status).toBe(200);
    expect(lines.join("\n")).not.toContain("fake-owner-password");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- staff-owner-bootstrap`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/staff-owner-bootstrap.ts
import { randomUUID } from "node:crypto";
import { PLATFORM_ADMIN_ROLE, SYSTEM_GRANTOR, bootstrapSecurity } from "@platform/security";
import type { Logger } from "@platform/utils";
import type { WiredAdmin } from "./composition";
import { staffIdentifier } from "./interfaces/staff-auth.admin-controller";

export interface BootstrapStaffOwnerInput {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly logger: Logger;
}

const expectOk = (response: { status: number; body: unknown }, step: string): void => {
  if (response.status >= 300) {
    throw new Error(`owner bootstrap step "${step}" failed with status ${response.status}`);
  }
};

/**
 * Plan 1B-2: creates the first owner from BOOTSTRAP_OWNER_EMAIL/PASSWORD (runtime env), once.
 * Idempotent by the stored credential: a second boot with the same env does nothing. The password
 * is never logged; the owner removes BOOTSTRAP_OWNER_PASSWORD from the env after first sign-in.
 */
export async function bootstrapStaffOwner(
  admin: WiredAdmin,
  input: BootstrapStaffOwnerInput,
): Promise<"created" | "exists"> {
  const identifier = staffIdentifier(input.email);
  if (await admin.securityWiring.passwordRegistrar.hasCredential(input.tenantId, identifier)) {
    input.logger.info("owner bootstrap: owner already exists", { tenantId: input.tenantId });
    return "exists";
  }

  const security = admin.securityWiring.security;
  await bootstrapSecurity(security, input.tenantId, input.logger);
  const externalId = randomUUID();
  admin.securityWiring.identityDirectory.register(externalId);
  expectOk(
    await security.registerPrincipal({
      tenantId: input.tenantId,
      externalId,
      kind: "human",
      displayName: input.email.trim().toLowerCase(),
      subjectRef: externalId,
    }),
    "registerPrincipal",
  );
  await admin.securityWiring.passwordRegistrar.setPassword({
    tenantId: input.tenantId,
    identifier,
    password: input.password,
    principalExternalId: externalId,
  });
  expectOk(
    await security.assignRole({
      tenantId: input.tenantId,
      principalExternalId: externalId,
      roleKey: PLATFORM_ADMIN_ROLE,
      grantedBy: SYSTEM_GRANTOR,
    }),
    "assignRole",
  );
  input.logger.info("owner bootstrap: owner created", { tenantId: input.tenantId });
  return "created";
}
```

> **`hasCredential` (part of this task).** Add `hasCredential(tenantId: string, identifier: string): Promise<boolean>` to the
> `PasswordRegistrar` port (services/security/src/application/password-credentials.ts):
>
> - `HashedPasswordAuthProvider`: `return (await this.deps.store.find(tenantId, normalizeIdentifier(identifier))) !== null;`
> - the in-memory adapter in `wireSecurity` (Plan 1B-1's `passwordRegistrar` fallback): `hasCredential: () => Promise.resolve(false)`
>   (the reference provider has no lookup; it is tests/local only — document that in a one-line comment).
>   Add one unit test to `hashed-password-auth-provider.test.ts`: false before `setPassword`, true after, case-insensitive.

In `server.ts`:

- Add to `AdminHttpDeps`:

```ts
  /** Plan 1B-2: create the first owner (idempotent) from runtime env. Absent ⇒ nothing happens. */
  readonly bootstrapOwner?: { readonly email: string; readonly password: string };
```

- After `const admin = wireAdmin({...});`:

```ts
if (deps.bootstrapOwner !== undefined && deps.tenantId !== undefined) {
  await bootstrapStaffOwner(admin, {
    tenantId: deps.tenantId,
    email: deps.bootstrapOwner.email,
    password: deps.bootstrapOwner.password,
    logger,
  });
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/admin run test`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/staff-owner-bootstrap.ts apps/admin/src/staff-owner-bootstrap.test.ts apps/admin/src/http/server.ts services/security/src
git commit -m "feat(admin): bootstrap the first owner from runtime env"
```

---

### Task 7: Runtime selects the auth mode

**Files:**

- Modify: `apps/runtime/src/config.ts`
  - schema: next to `AUTH_ISSUER_URL`, line ≈ 70;
  - `superRefine`: line ≈ 325.
- Modify: `apps/runtime/src/composition.ts`
  - authenticator and access control at lines ≈ 246–280;
  - TOTP at line ≈ 318.
- Modify: `apps/runtime/src/api.ts`: inside `createAdminHttpApi({...})`, line ≈ 496.
- Test: `apps/runtime/src/config.native-auth.test.ts`

**Interfaces:**

- Config keys:

| Key                        | Rule                  | Default |
| -------------------------- | --------------------- | ------- |
| `AUTH_MODE`                | `"ory"` or `"native"` | `"ory"` |
| `AUTH_SIGNING_KEY`         | optional string       | —       |
| `STAFF_TOKEN_TTL_SECONDS`  | int, 300..86400       | 7200    |
| `BOOTSTRAP_OWNER_EMAIL`    | optional email        | —       |
| `BOOTSTRAP_OWNER_PASSWORD` | optional, min 12      | —       |
| `MFA_TOTP_KEY`             | optional, min 32      | —       |

- Refinements:
  - **native** requires `AUTH_SIGNING_KEY` and `AUTH_ISSUER_URL`. `AUTH_JWKS_URL`, `KETO_*` and `KRATOS_*` are then NOT required, even outside local.
  - **ory** keeps today's rules exactly.
  - The two `BOOTSTRAP_OWNER_*` keys must be set together.

- [ ] **Step 1: Write the failing test**

Use `loadRuntimeConfig(env)` (config.ts:449), as `config.shop-domains.test.ts` does.

```ts
// apps/runtime/src/config.native-auth.test.ts
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

const key = Buffer.from(
  generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
).toString("base64");

describe("AUTH_MODE (Plan 1B-2)", () => {
  it("defaults to ory with the usual defaults", () => {
    const c = loadRuntimeConfig({ APP_ENV: "local" });
    expect(c.AUTH_MODE).toBe("ory");
    expect(c.STAFF_TOKEN_TTL_SECONDS).toBe(7200);
  });

  it("native needs a signing key and an issuer", () => {
    expect(() => loadRuntimeConfig({ APP_ENV: "local", AUTH_MODE: "native" })).toThrow(
      /AUTH_SIGNING_KEY/,
    );
    expect(() =>
      loadRuntimeConfig({ APP_ENV: "local", AUTH_MODE: "native", AUTH_SIGNING_KEY: key }),
    ).toThrow(/AUTH_ISSUER_URL/);
  });

  it("native outside local does not demand the Ory URLs", () => {
    const c = loadRuntimeConfig({
      APP_ENV: "production",
      AUTH_MODE: "native",
      AUTH_SIGNING_KEY: key,
      AUTH_ISSUER_URL: "https://api.example.test/",
    });
    expect(c.AUTH_MODE).toBe("native");
  });

  it("bootstrap owner email and password come together; the password is at least 12", () => {
    expect(() =>
      loadRuntimeConfig({ APP_ENV: "local", BOOTSTRAP_OWNER_EMAIL: "o@x.test" }),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({
        APP_ENV: "local",
        BOOTSTRAP_OWNER_EMAIL: "o@x.test",
        BOOTSTRAP_OWNER_PASSWORD: "short",
      }),
    ).toThrow();
  });
});
```

> If `APP_ENV: "production"` trips OTHER pre-existing production requirements (for example `DATABASE_URL` or G-84 guards inside `loadRuntimeConfig`), supply the minimum extra keys those rules ask for. Read the thrown issues. The test's point is only that no `KETO_*`/`KRATOS_*`/`AUTH_JWKS_URL` issue is raised in native mode.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/runtime run test -- config.native-auth`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`config.ts` schema, next to `AUTH_ISSUER_URL`:

```ts
    /**
     * Plan 1B-2: who signs staff in. `ory` (default) = Hydra/Kratos/Keto as today. `native` = this
     * runtime verifies passwords (Plan 1B-1), signs ES256 tokens with AUTH_SIGNING_KEY, and authorises
     * with the fixed staff role table — no Ory service is needed.
     */
    AUTH_MODE: z.enum(["ory", "native"]).default("ory"),
    /** Plan 1B-2: EC P-256 PKCS#8 private key (PEM, or base64 of the PEM). Secret. Required when native. */
    AUTH_SIGNING_KEY: z.string().min(1).optional(),
    STAFF_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(7200),
    /** Plan 1B-2: first owner, created once at boot. Remove the password after first sign-in. */
    BOOTSTRAP_OWNER_EMAIL: z.string().email().optional(),
    BOOTSTRAP_OWNER_PASSWORD: z.string().min(12).optional(),
    /** G-87: key the TOTP secrets are encrypted under. Secret, ≥32 chars. Absent ⇒ legacy constant (local only). */
    MFA_TOTP_KEY: z.string().min(32).optional(),
```

In `superRefine`, wrap the existing Ory loop:

```ts
if (cfg.AUTH_MODE === "ory") {
  for (const key of ["KETO_WRITE_URL", "KRATOS_PUBLIC_URL", "KRATOS_ADMIN_URL"] as const) {
    // … existing body unchanged …
  }
} else {
  for (const key of ["AUTH_SIGNING_KEY", "AUTH_ISSUER_URL"] as const) {
    if (cfg[key] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when AUTH_MODE=native (Plan 1B-2).`,
      });
    }
  }
}
if ((cfg.BOOTSTRAP_OWNER_EMAIL === undefined) !== (cfg.BOOTSTRAP_OWNER_PASSWORD === undefined)) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["BOOTSTRAP_OWNER_PASSWORD"],
    message: "BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD must be set together.",
  });
}
```

In `composition.ts`, replace the `AUTH_JWKS_URL`/`AUTH_ISSUER_URL` guard plus the `authenticator`/`accessControl` construction (lines ≈ 246–280) with a mode switch:

```ts
let authenticator: Authenticator;
let accessControl: AccessControl;
let staffTokenIssuer: NativeTokenIssuer | undefined;
if (config.AUTH_MODE === "native") {
  if (config.AUTH_SIGNING_KEY === undefined || config.AUTH_ISSUER_URL === undefined) {
    throw new Error("AUTH_MODE=native requires AUTH_SIGNING_KEY + AUTH_ISSUER_URL (Plan 1B-2).");
  }
  staffTokenIssuer = new NativeTokenIssuer({
    privateKey: loadSigningKey(config.AUTH_SIGNING_KEY),
    issuer: config.AUTH_ISSUER_URL,
    audience: config.AUTH_AUDIENCE,
    ttlSeconds: config.STAFF_TOKEN_TTL_SECONDS,
  });
  // buildRuntimeCore is synchronous (composition.ts:200): resolve the local JWKS lazily, once.
  const resolver = localKeyResolver(staffTokenIssuer);
  authenticator = new JwtVerifier({
    issuer: config.AUTH_ISSUER_URL,
    audience: config.AUTH_AUDIENCE,
    getKey: (header, token) => resolver.then((getKey) => getKey(header, token)),
    logger,
  });
  accessControl = new RoleTableAccessControl();
  logger.info("auth: native staff sign-in (own ES256 issuer, role-table authorization)");
} else {
  // … the existing D-048 guard, JwtVerifier(jwksUrl) and Keto/local/throw block, unchanged …
}
```

Then:

- Expose `staffTokenIssuer` on `RuntimeCore`: add `readonly staffTokenIssuer?: NativeTokenIssuer;` to the interface, and to the returned object with the conditional-spread pattern.
- Add the imports from `@platform/auth`: `NativeTokenIssuer`, `loadSigningKey`, `localKeyResolver`, `RoleTableAccessControl`.
- TOTP (line ≈ 318): `new TotpMfaProvider(new NodeCrypto(), clock, config.MFA_TOTP_KEY === undefined ? {} : { keyRef: config.MFA_TOTP_KEY })`.

In `api.ts`, inside `createAdminHttpApi({...})`:

```ts
    ...(runtime.staffTokenIssuer === undefined ? {} : { staffTokenIssuer: runtime.staffTokenIssuer }),
    staffTokenTtlSeconds: runtime.config.STAFF_TOKEN_TTL_SECONDS,
    ...(runtime.config.BOOTSTRAP_OWNER_EMAIL === undefined ||
    runtime.config.BOOTSTRAP_OWNER_PASSWORD === undefined
      ? {}
      : {
          bootstrapOwner: {
            email: runtime.config.BOOTSTRAP_OWNER_EMAIL,
            password: runtime.config.BOOTSTRAP_OWNER_PASSWORD,
          },
        }),
```

**The worker:**

- Check whether `apps/runtime/src/worker.ts` builds the same `RuntimeCore`.
- In native mode the worker never authenticates HTTP requests, so the mode switch only needs to not throw there.
- Verify by running the worker's own tests: `pnpm.cmd --filter @platform/runtime run test -- worker`.

**The `tenant-mode-guard` classification test:**

- This task adds no `TENANT_DEFAULT_ID` read. If the guard test fails, stop and report.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/runtime run test`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/runtime run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src/config.ts apps/runtime/src/composition.ts apps/runtime/src/api.ts apps/runtime/src/config.native-auth.test.ts
git commit -m "feat(runtime): select ory or native staff auth by AUTH_MODE"
```

---

### Task 8: admin-web native sign-in

**Files:**

- Create: `apps/admin-web/src/lib/auth/native.ts`
- Test: `apps/admin-web/src/lib/auth/native.test.ts`
- Create: `apps/admin-web/src/app/auth/native-login/route.ts`
- Modify: `apps/admin-web/src/app/login/page.tsx`: at the top of the page component, `if (isNativeAuth()) return <NativeLoginForm … />`, before any Kratos flow fetch.
- Modify: `apps/admin-web/src/middleware.ts`:
  - `getJwks()` passes headers;
  - the unauthenticated branch at line ≈ 199: when native, redirect to `/login?return_to=…` instead of Hydra;
  - `"/auth/native-login"` added to `PUBLIC_PREFIXES`.
- Modify: `apps/admin-web/src/lib/auth/session.ts`: `getJwks()` passes the same headers.

**Interfaces:**

- Produces:
  - `isNativeAuth(): boolean`, which is true when `process.env.AUTH_MODE === "native"`;
  - `jwksFetchHeaders(): Record<string, string>`, which is `{ "x-tenant-id": TENANT_DEFAULT_ID }`. The runtime's JWKS route is tenant-resolved like every route.
  - `exchangePassword({ runtimeUrl, tenantId, email, password, fetchImpl })`, which returns one of:
    - `{ ok: true; token: string; expiresIn: number }`
    - `{ ok: false; reason: "invalid" | "mfa" | "unavailable" }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin-web/src/lib/auth/native.test.ts
import { describe, expect, it } from "vitest";
import { exchangePassword } from "./native";

const ok = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

const base = {
  runtimeUrl: "https://api.test",
  tenantId: "tenant-local",
  email: "o@x.test",
  password: "fake-password-1",
};

describe("exchangePassword", () => {
  it("returns the token on 200 and posts to the staff login route with the tenant header", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({ accessToken: "t", tokenType: "Bearer", expiresIn: 7200 }),
        { status: 200 },
      );
    }) as typeof fetch;
    expect(await exchangePassword({ ...base, fetchImpl })).toEqual({
      ok: true,
      token: "t",
      expiresIn: 7200,
    });
    expect(seen?.url).toBe("https://api.test/api/v1/public/auth/staff/login");
    expect((seen?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe("tenant-local");
  });

  it.each([
    [401, "invalid"],
    [403, "mfa"],
    [503, "unavailable"],
    [500, "unavailable"],
  ] as const)("maps %s to %s", async (status, reason) => {
    expect(await exchangePassword({ ...base, fetchImpl: ok(status, {}) })).toEqual({
      ok: false,
      reason,
    });
  });

  it("a network failure is 'unavailable', never a throw", async () => {
    const fetchImpl = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(await exchangePassword({ ...base, fetchImpl })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter admin-web run test -- native`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin-web/src/lib/auth/native.ts
/** Plan 1B-2: native staff sign-in helpers (no Ory). Pure, so they are testable without Next. */

export function isNativeAuth(): boolean {
  return process.env["AUTH_MODE"] === "native";
}

/** The runtime resolves a tenant for every route, JWKS included. */
export function jwksFetchHeaders(): Record<string, string> {
  return { "x-tenant-id": process.env["TENANT_DEFAULT_ID"] ?? "tenant-local" };
}

export type ExchangeResult =
  | { readonly ok: true; readonly token: string; readonly expiresIn: number }
  | { readonly ok: false; readonly reason: "invalid" | "mfa" | "unavailable" };

export async function exchangePassword(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<ExchangeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${input.runtimeUrl}/api/v1/public/auth/staff/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": input.tenantId },
      body: JSON.stringify({ email: input.email, password: input.password }),
      cache: "no-store",
    });
    if (response.status === 401) return { ok: false, reason: "invalid" };
    if (response.status === 403) return { ok: false, reason: "mfa" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const body = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown };
    if (typeof body.accessToken !== "string" || typeof body.expiresIn !== "number") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, token: body.accessToken, expiresIn: body.expiresIn };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
```

```ts
// apps/admin-web/src/app/auth/native-login/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { exchangePassword, isNativeAuth } from "@/lib/auth/native";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { publicOrigin } from "@/lib/public-origin";

/** Plan 1B-2: the native login form posts here; on success the session cookie holds the token. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth()) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const returnTo = safeReturnTo(String(form.get("return_to") ?? "/"), origin);
  const result = await exchangePassword({
    runtimeUrl: process.env["RUNTIME_API_URL"] ?? "http://localhost:3080",
    tenantId: process.env["TENANT_DEFAULT_ID"] ?? "tenant-local",
    email,
    password,
  });
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/login?error=${result.reason}`, origin), 303);
  }
  const response = NextResponse.redirect(new URL(returnTo, origin), 303);
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: result.expiresIn,
  });
  return response;
}
```

> Check `safeReturnTo`'s real signature in `lib/auth/safe-return-to.ts` and `publicOrigin`'s in `lib/public-origin.ts`, then match them. In native mode `authConfig.cookieDomain` should be unset (`COOKIE_DOMAIN` absent), so the cookie is host-only on admin-web's own domain.

**Login page native form.** Inside `app/login/page.tsx`, before the Kratos flow logic, render a minimal server-component form when `isNativeAuth()` is true:

- it uses the existing `Card`, `CardContent`, `Input`, `Label`, `Button` and `BrandMark` imports already at the top of that file;
- it does `method="post" action="/auth/native-login"`;
- it has the fields `email` (type email, required), `password` (type password, required), and a hidden `return_to` taken from the `return_to` search param;
- it shows an error line for `?error=invalid|mfa|unavailable`. Use the existing dictionary if one exists for login errors, otherwise these exact strings:

| Error         | Text                                                          |
| ------------- | ------------------------------------------------------------- |
| `invalid`     | "Email or password is incorrect / الإيميل أو كلمة السر غلط"   |
| `mfa`         | "Two-step verification is required / مطلوب تحقق بخطوتين"      |
| `unavailable` | "Sign-in is temporarily unavailable / الدخول غير متاح مؤقتاً" |

Keep it in its own component file, `app/login/native-login-form.tsx`, if `page.tsx` grows past its current structure.

**Middleware:**

- `getJwks()` becomes `createRemoteJWKSet(new URL(AUTH_JWKS_URL), { headers: jwksFetchHeaders() })`.
- In the unauthenticated tail (the block that builds the Hydra `authorizeUrl`, line ≈ 199), add at its start:

```ts
if (isNativeAuth()) {
  const login = new URL("/login", origin);
  login.searchParams.set("return_to", `${pathname}${search}`);
  const response = NextResponse.redirect(login);
  clearAuthCookies(response);
  return response;
}
```

- Add `"/auth/native-login"` to `PUBLIC_PREFIXES`.

**`session.ts`:** the same `headers: jwksFetchHeaders()` in its `getJwks()`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm.cmd --filter admin-web run test`
Expected: PASS. The existing middleware and callback tests are unchanged in ory mode.

Run: `pnpm.cmd --filter admin-web run typecheck`
Expected: exit 0.

Run: `pnpm.cmd --filter admin-web run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/auth/native.ts apps/admin-web/src/lib/auth/native.test.ts apps/admin-web/src/app/auth/native-login/route.ts apps/admin-web/src/app/login apps/admin-web/src/middleware.ts apps/admin-web/src/lib/auth/session.ts
git commit -m "feat(admin-web): sign staff in natively when AUTH_MODE=native"
```

---

### Task 9: Docs, gaps, gates, push

**Files:**

- Modify: `infrastructure/railway/README.md`
- Modify: `docs/KNOWN_GAPS.md`
- Modify: `docs/architecture/23-platform-gap-register.md`

- [ ] **Step 1: Document the switch**

Add a "Native staff sign-in (Plan 1B-2)" section to `infrastructure/railway/README.md`.

**Variables:**

| Service   | Variable                   | Value                                                     |
| --------- | -------------------------- | --------------------------------------------------------- |
| API       | `AUTH_MODE`                | `native`                                                  |
| API       | `AUTH_SIGNING_KEY`         | secret: base64 PEM, see the generator command below       |
| API       | `AUTH_ISSUER_URL`          | `https://<api public domain>/`                            |
| API       | `MFA_TOTP_KEY`             | secret, ≥32 chars                                         |
| API       | `BOOTSTRAP_OWNER_EMAIL`    | owner's email (one boot only)                             |
| API       | `BOOTSTRAP_OWNER_PASSWORD` | ≥12 chars (one boot only; **remove after first sign-in**) |
| admin-web | `AUTH_MODE`                | `native`                                                  |
| admin-web | `AUTH_ISSUER_URL`          | same value as the API's                                   |
| admin-web | `AUTH_JWKS_URL`            | `https://<api public domain>/api/v1/public/auth/jwks`     |
| admin-web | `COOKIE_DOMAIN`            | **unset**                                                 |

**Generator command,** run in the API service's Railway Console. It prints a secret: paste it into Railway variables and nowhere else.

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'});console.log(Buffer.from(k).toString('base64'))"
```

and for `MFA_TOTP_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Rollback:** set `AUTH_MODE=ory` on both services (or delete it). Nothing else changes.

- [ ] **Step 2: Gaps**

- Mark **G-87 closed** (Task 1), and note: "TOTP enrollments made before `MFA_TOTP_KEY` was set must be re-enrolled; none are known on the live deployment."
- Add the next number as **open, Low**:

> Native staff tokens are not revocable before expiry (default 2 h). Logout clears the dashboard cookie only. Fix with a session check on refresh in a later plan.

- [ ] **Step 3: Run the gates, sequentially**

Run each, in order:

- `pnpm.cmd --filter @platform/auth run test`
- `pnpm.cmd --filter @platform/security run test`
- `pnpm.cmd --filter @platform/admin run test`
- `pnpm.cmd --filter @platform/runtime run test`
- `pnpm.cmd --filter admin-web run test`

Then:

- `pnpm.cmd -r --no-bail run typecheck`
- `pnpm.cmd -r --no-bail run lint`
- `pnpm.cmd arch`

Expected: every one exits 0, with no new lint warnings.

- [ ] **Step 4: Commit and push**

```bash
git add infrastructure/railway/README.md docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-07-native-staff-signin.md
git commit -m "docs(auth): document native staff sign-in, close g-87"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- With `AUTH_MODE` unset, every existing test passes and the live deployment is unchanged.
- With `AUTH_MODE=native`:
  - an owner created by the bootstrap signs in at admin-web's `/login` with email and password;
  - lands on the dashboard;
  - and API calls are authorised by the role table: admin = all, operator = shop data without money or security, viewer = read only.
- A customer's credentials never sign anyone in as staff.
- TOTP secrets are encrypted under `MFA_TOTP_KEY`, never under a source-code constant.
- No private key, password or token appears in a log, test fixture file or commit.

## Stop conditions (stop and report in Arabic)

- Any existing test outside the listed files fails.
- The lazy `getKey` wrapper does not typecheck against jose's `JWTVerifyGetKey`.
- The rate-limiter wrapping of the customer login cannot be reused for the staff login.
- The `tenant-mode-guard` classification test fails.

## Owner steps after merge (not for agents)

1. Generate the two secrets with the commands in the README section, in the API's Railway Console. Put them in Railway Variables.
2. Set the API variables (`AUTH_MODE=native`, `AUTH_SIGNING_KEY`, `AUTH_ISSUER_URL`, `MFA_TOTP_KEY`, `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`), then the admin-web variables. Redeploy both.
3. Open the dashboard → the new login form → sign in as the owner.
4. **Delete `BOOTSTRAP_OWNER_PASSWORD`** from Railway and redeploy the API.
5. If anything fails: set `AUTH_MODE=ory` on both and redeploy. Ory sign-in returns exactly as before.
