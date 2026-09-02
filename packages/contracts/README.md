# @platform/contracts

Outbound **service contracts** — interfaces only. This is the dedicated home for cross-cutting,
generic platform ports the application depends on and infrastructure implements:

- **`IdGenerator`**, **`Clock`** — id/time generation.
- **`Authenticator`** (`verify(token) → Principal | null`) + **`Principal`**/**`PrincipalKind`** —
  authentication seam (Ory adapter later; resolved at the interfaces boundary).
- **`AccessControl`** (`authorize(principal, permission) → boolean`) + **`Permission`** —
  authorization seam (RBAC for Phase 1; ReBAC/resource-level later). Callers map `null`/`false` to
  the kernel `AuthenticationError`/`AuthorizationError` (`@platform/utils`).

## Rules

- **Interfaces only.** No implementations, no DI, no framework code, no business logic.
- **No runtime dependencies** (TypeScript types only) — this package is a dependency-graph leaf.
- **DI tokens do not live here.** They stay in `@platform/application` (co-located with the DI
  container). This package only declares the contracts; the application owns wiring.
- **Infrastructure adapters depend only on this package**, never on `@platform/application`.

## Extension points

- Implement these ports in infrastructure (e.g. an Ory `Authenticator`, an RBAC/Keto
  `AccessControl`); the domain/application never change. Add resource-level authorization by adding
  an optional argument later (non-breaking).

See [ADR-0002](../../docs/architecture/adr/0002-outbound-ports-in-contracts-package.md) and
`docs/DECISIONS.md` (D-018). Persistence ports remain in `@platform/repository` (D-006).
