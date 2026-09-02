# H-03 — MFA verification accepts the hardcoded code `123456`, and there is no seam to replace it

| Field                      | Value                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High (becomes Critical the moment H-02 is fixed)                                                                                                  |
| **Area**                   | Security / Authentication                                                                                                                         |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                |
| **Blocker verdict**        | **True blocker.** The _stub_ is an intentional offline reference; the **absence of an injection seam in the production composition path** is not. |
| **Public contract change** | **No** — the fix adds optional fields, matching the eight seams `SecurityWiringDeps` already has.                                                 |

---

## 1. Location

| File                                                              | Lines                  | What is there                                                                                   |
| ----------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `services/security/src/composition.ts`                            | 428–431                | `passwordProvider` / `totpProvider` constructed unconditionally                                 |
| `services/security/src/composition.ts`                            | 409, 419, 425          | `deviceTrust`, `telemetry`, `geoIp` — same problem                                              |
| `services/security/src/composition.ts`                            | 479–480                | Both resolvers passed into `SecurityDeps`                                                       |
| `services/security/src/composition.ts`                            | (`SecurityWiringDeps`) | **No** `mfaProviders` / `authProviders` / `deviceTrust` / `geoIp` / `telemetry` field           |
| `services/security/src/infrastructure/in-memory-auth-adapters.ts` | 130–142                | `InMemoryTotpMfaProvider` — `validCode = "123456"`                                              |
| `services/security/src/infrastructure/in-memory-auth-adapters.ts` | 115–127                | `InMemoryPasswordAuthProvider` — plaintext, non-constant-time compare                           |
| `services/security/src/infrastructure/in-memory-auth-adapters.ts` | 144–162                | `InMemoryGeoIp` — empty lookup table                                                            |
| `apps/runtime/src/api.ts`                                         | 41–42                  | Passes `prisma` + `tenantId`, so the **Prisma branch of `wireSecurity` is taken in production** |

---

## 2. Current implementation

### 2a. The stub

```ts
// services/security/src/infrastructure/in-memory-auth-adapters.ts:129-142
/** Reference in-memory TOTP MFA provider (offline/tests). Real authenticator/WebAuthn adapters swap in. */
export class InMemoryTotpMfaProvider implements MfaProviderPort {
  readonly method: MfaMethodKind = "totp";
  constructor(private readonly validCode = "123456") {}
  async enroll(input: { principalRef: string }): Promise<{ secretRef: string }> {
    return { secretRef: `totp:${input.principalRef}` };
  }
  async issueChallenge(): Promise<{ challengeRef: string }> {
    return { challengeRef: `chal_${Date.now()}` };
  }
  async verify(input: { secretRef: string | null; code: string }): Promise<boolean> {
    return input.code === this.validCode;
  }
}
```

`verify` ignores `secretRef` entirely. Any principal, any enrollment, code `123456` → `true`.

### 2b. It is constructed unconditionally, in both branches

```ts
// services/security/src/composition.ts:428-431
const passwordProvider = new InMemoryPasswordAuthProvider();
const totpProvider = new InMemoryTotpMfaProvider();
const authProviders = new MapAuthenticationProviderResolver([passwordProvider]);
const mfaProviders = new MapMfaProviderResolver([totpProvider]);
```

These lines sit in `wireSecurity`'s common body, **after** `buildInfra(deps)` has already selected the Prisma or in-memory persistence branch (line 387). They run identically either way.

### 2c. There is no seam — and that is the anomaly

`SecurityWiringDeps` provides `deps.X ??` override seams for **eight** ports:

```ts
readonly identityDirectory?: IdentityDirectoryPort;
readonly relationshipCheck?: RelationshipCheckPort;
readonly consentStore?: ConsentProjectionStore;
readonly consent?: ConsentPort;
readonly identityProjection?: IdentityProjectionStore;
readonly sessionRevocation?: SessionRevocationPort;
readonly kms?: KmsPort;
readonly crypto?: CryptoPort;
readonly threatIntel?: ThreatIntelResolver;
```

and honours every one of them (lines 407–447):

```ts
const kms: KmsPort = deps.kms ?? new InMemoryKms();
const crypto: CryptoPort = deps.crypto ?? new NodeCrypto();
const threatIntel = deps.threatIntel ?? new MultiThreatIntelResolver([threatProvider]);
```

**`mfaProviders`, `authProviders`, `deviceTrust`, `geoIp`, and `telemetry` have no such field and no `??`.** They are hardcoded. `WiredSecurity` even exposes them by concrete type rather than by port:

```ts
// services/security/src/composition.ts:362-369
readonly deviceTrust: InMemoryDeviceTrust;
readonly telemetry: InMemorySecurityTelemetry;
readonly passwordProvider: InMemoryPasswordAuthProvider;
readonly totpProvider: InMemoryTotpMfaProvider;
readonly geoIp: InMemoryGeoIp;
```

### 2d. This composition is reached in production

`apps/runtime/src/api.ts:41-42` passes `prisma` and `tenantId` → `createAdminHttpApi` → `wireAdmin(deps)` → `wireSecurity(deps)` → `buildInfra` takes the Prisma branch (`composition.ts:273`). **The stub MFA provider is in the production object graph today.**

---

## 3. Why it is incorrect

1. **A test double with a hardcoded credential is reachable from a production composition root with no supported way to replace it.** The stub is correctly labelled _"Reference in-memory TOTP MFA provider (offline/tests). Real authenticator/WebAuthn adapters swap in."_ — but there is no field through which to swap. The comment describes an operation the type system does not permit.
2. **The inconsistency is the tell.** Nine ports have seams; five do not. `kms` and `crypto` — genuinely important, but _less_ directly exploitable than MFA verification — both have one. There is no design reason for MFA to be the exception; it looks like an oversight during the H-3 (G-SEC-2) provider sprint, which added seams for exactly the ports that sprint touched.
3. **`WiredSecurity` returning concrete `InMemory*` types entrenches it.** Any future attempt to inject a real provider is a breaking change to `WiredSecurity`, not an additive one — the interface has hardcoded the test doubles into the context's public shape.
4. **Related, same lines:** `geoIp = new InMemoryGeoIp()` has an empty table, so `RiskEngine` receives no Tor/VPN/IP-reputation/ASN/new-geo signals and scores every request as if from a clean, known origin. `deviceTrust = new InMemoryDeviceTrust(deps.trustedDevices ?? [])` means no device is ever trusted. `telemetry = new InMemorySecurityTelemetry()` means `OtelSecurityTelemetry` (`apps/runtime/src/security/security-telemetry-otel.ts:15`) can never be injected — a direct contributor to **H-04**.

---

## 4. Production impact

**Today: latent.** Per **H-02**, `SecurityPermissionGuard` is never mounted, so `EvaluateAccess` — and with it the MFA step-up path — is not on any request path. The stub is composed but not exercised.

**That is protection by accident, not by control.** The moment any of the following happens, this becomes an authentication bypass:

- H-02 is fixed and `buildSecurityHttpGuard` is mounted;
- any admin route is added that calls Security's MFA verification use cases through `SecurityController` (the controller **is** wired into the admin app today via six `Security*AdminController` slices, `apps/admin/src/composition.ts:404-427`);
- the `SecuritySdk` is used by any new caller.

The exposure would be: **any principal satisfies MFA step-up with the literal string `123456`, regardless of enrollment.** Since step-up is the control guarding high-risk operations in the zero-trust design, this defeats the entire risk-based authorization model.

Secondary: `InMemoryPasswordAuthProvider` (lines 115–127) holds an empty account map in production, so password authentication through Security fails for everyone — fail-closed, therefore not dangerous, but it means Security's own authentication surface is non-functional. It also compares credentials with `!==` (non-constant-time), which would be a timing-oracle defect if it were ever populated.

---

## 5. Smallest additive fix

**Add the five missing seams, matching the existing pattern exactly, plus a fail-closed default.** ~20 lines.

### Step 1 — add optional fields to `SecurityWiringDeps`

```ts
// services/security/src/composition.ts — additive, mirrors the existing 9 seams
/** Live authentication providers (Kratos/OIDC/LDAP). Absent ⇒ the offline reference provider. */
readonly authProviders?: AuthenticationProviderResolver;
/** Live MFA providers (TOTP/WebAuthn/SMS). Absent ⇒ the offline reference provider. */
readonly mfaProviders?: MfaProviderResolver;
/** Live device-trust source. Absent ⇒ the seeded in-memory list. */
readonly deviceTrust?: DeviceTrustPort;
/** Live GeoIP enrichment. Absent ⇒ an empty in-memory table. */
readonly geoIp?: GeoIpPort;
/** Live security telemetry (OTel). Absent ⇒ the in-memory recorder. */
readonly telemetry?: SecurityTelemetryPort;
```

### Step 2 — honour them, and fail closed on the stub in production

```ts
const totpProvider = new InMemoryTotpMfaProvider();
const mfaProviders =
  deps.mfaProviders ??
  (() => {
    if (deps.prisma !== undefined) {
      throw new Error(
        "wireSecurity: a real MfaProviderResolver is required when prisma is provided — " +
          "InMemoryTotpMfaProvider accepts the hardcoded code '123456' for every principal.",
      );
    }
    return new MapMfaProviderResolver([totpProvider]);
  })();
```

Keying the guard on `deps.prisma !== undefined` reuses the signal the context **already** treats as "this is the production slice" (`composition.ts:273`) — no new config field is needed, and offline tests that pass no `prisma` are unaffected.

Apply the same shape to `authProviders`.

### Step 3 — widen `WiredSecurity`'s types to the ports

```ts
readonly deviceTrust: DeviceTrustPort;          // was InMemoryDeviceTrust
readonly telemetry: SecurityTelemetryPort;      // was InMemorySecurityTelemetry
readonly passwordProvider: AuthenticationProviderPort;
readonly totpProvider: MfaProviderPort;
readonly geoIp: GeoIpPort;
```

Tests that seed these (`wired.passwordProvider.register(...)`, `wired.geoIp.seed(...)`) call methods not on the port interfaces. Either keep the concrete types **only** in a `testing` subpath export, or have tests construct and inject the doubles they seed — the latter is cleaner and is what the new seams make possible.

### Step 4 (follow-on, not this fix) — wire real providers in `wireSecurityRuntime`

`apps/runtime/src/security/wire-security-runtime.ts:44-76` already assembles Ory adapters and cloud providers. Once Step 1 lands, the real MFA/auth providers bind there alongside `identityDirectory`, `relationshipCheck`, and `sessionRevocation`. Note this is blocked behind H-02 and C-09.

---

## 6. Public contract impact

**Steps 1–2: none.** Optional fields on a wiring-deps interface. Every existing caller compiles and behaves identically. `MfaProviderPort`, `AuthenticationProviderPort`, `DeviceTrustPort`, `GeoIpPort`, and `SecurityTelemetryPort` are unchanged. The fail-closed branch only triggers when `prisma` is supplied _and_ no real provider is injected — a configuration that is currently unsafe by definition.

**Step 3: a narrowing of `WiredSecurity`'s exposed types.** Technically a source-breaking change for any consumer calling `InMemory*`-only methods on those fields. Repository-wide, the only such consumers are `services/security`'s own tests. No `apps/` code touches these fields — `apps/admin/src/composition.ts:303, 404-427` uses only `security.security` (the controller). **Impact is confined to the package's own test suite.**

---

## 7. Blocker or intentional deferral?

**The stub is an intentional deferral. Its unremovability from the production graph is a true blocker.**

The deferral is legitimate and documented: _"Reference in-memory TOTP MFA provider (offline/tests). Real authenticator/WebAuthn adapters swap in."_ Offline reference adapters are this codebase's established and generally well-executed pattern.

What is not legitimate is that **the swap the comment promises is structurally impossible**, while nine sibling ports in the same function support exactly that swap. `services/security/src/composition.ts:266-269` claims _"No in-memory repositories remain in production"_ — true for repositories, and false for auth/MFA/device/geo/telemetry, which the same function hardcodes twenty lines later.

`docs/KNOWN_GAPS.md` does not track this. It is discoverable only by reading `wireSecurity` line by line.

**Verdict: true blocker.** Not because the bypass is exploitable today — H-02 prevents that — but because the only thing standing between a hardcoded MFA code and a production request path is a _separate_ unfinished feature. That is not a control. Step 2's fail-closed guard makes it one, and it is ~10 lines.

---

## 8. How this was verified

- `services/security/src/composition.ts` read: `SecurityWiringDeps` (full), `buildInfra` (271–357), and the provider construction block (406–500).
- `services/security/src/infrastructure/in-memory-auth-adapters.ts` read in full (163 lines).
- `grep 'readonly (telemetry|deviceTrust|geoIp|passwordProvider|totpProvider|mfaProviders|authProviders)\??:'` over `composition.ts` → matches only in `WiredSecurity` (the return type), never in `SecurityWiringDeps`.
- `apps/runtime/src/api.ts:31-47` read — confirms `prisma`/`tenantId` reach `wireSecurity`, so the Prisma branch is production-active.
- `apps/runtime/src/security/wire-security-runtime.ts` read in full — builds `SecurityWiringDeps` with 9 overrides, none for MFA/auth.
- `git grep -n "crypto.hash(\|\.hash("` over `services/security` → `mfa.use-cases.ts:138` (recovery-code hashing, see L-5).
- `git grep -n "buildSecurityHttpGuard"` → 1 hit (its own definition) — the basis for the "latent today" assessment.
- No code was modified.
