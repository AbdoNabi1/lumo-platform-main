# Fix O15: sealed merchant credentials must not carry their own key (payments + shipping)

`OPUS: AGREED (self-review below) · reviewer: Opus (owner ruling 2026-11-24)`

**Owner:** agreed order 2026-11-26 ("موافق": step 2 = this fix); "كمل" 2026-11-27.
**Branch:** `morbeh/sealed-credentials-o15` from origin/main `2daffdc8`.

**Verified facts (code, 2026-11-27):**

- `packages/secrets/src/envelope.ts` `EnvelopeCipher.seal` returns `{v:1, alias, kekRef, wrappedDek, ciphertext}` and `open` unwraps with the EMBEDDED `envelope.kekRef`.
- `@platform/security` `NodeCrypto.key(ref) = scryptSync(ref, "lumo-security", 32)` ⇒ the KEK is a pure function of the kekRef string. Storing kekRef next to the ciphertext = storing the key.
- Persisted envelopes with kekRef: `services/payments/src/infrastructure/envelope-payment-credential-vault.ts` (`JSON.stringify(envelope)`), `services/shipping/src/infrastructure/envelope-carrier-credential-vault.ts` (same). Notifications (Wave 2b2) already strips kekRef; lead-site branch fixed ad-platforms the same way (b1f60deb).
- Consequence: anyone with a DB copy (or a Supabase backup) can decrypt merchants' Paymob/Bosta credentials.

**Decisions:**

- D53 Envelope v2 at the package level: `seal` emits `{v:2, alias, wrappedDek, ciphertext}` — no kekRef. `open` NEVER uses a kekRef read from storage: it resolves candidates from the trusted `KeyAliasRegistry` for the envelope's alias (current first, then recorded previous versions) and tries each (AES-GCM auth fails on a wrong key). v1 envelopes are still opened, the same way (embedded kekRef ignored). Unknown alias / no candidate opens ⇒ one generic error, no detail. Every service gets the fix through the package; vault adapters stop persisting `kekRef` and re-check nothing from storage except alias + version.
- D54 Rotation is mandatory, not optional: every current `PAYMENT_CREDENTIALS_KEK_REF` / `SHIPPING_CREDENTIALS_KEK_REF` value has been written into the DB (and its backups). New optional runtime envs `PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS`, `SHIPPING_CREDENTIALS_KEK_REF_PREVIOUS` (secret). Registry for each alias = previous (if set), then current.
- D55 Re-seal job: when a vault has a PREVIOUS ref, runtime-api runs a one-shot background re-seal after it starts listening: under a Postgres advisory lock (one replica), iterate every row holding a sealed credential (payments merchant credentials, shipping carrier settings; platform-scope read with a documented tenant-scanner exemption, writes through each row's own tenant scope), open, re-seal v2 under the current ref, update only if the stored blob is unchanged (compare-and-set). Rows already v2 under the current ref are skipped. Logs counts only (`resealed`, `skipped`, `failed`) — never ids' secrets or blobs. Idempotent; safe to run on every boot while PREVIOUS is set. Also exposed in the existing health/readiness detail as counts.
- D56 Inventory first: the implementer lists EVERY place a KEK ref or key material is persisted (incl. licensing stored-method sealer, security MFA/TOTP secrets, any `wrapKey` caller) and reports it; anything outside payments/shipping is fixed in the same branch only if it uses `EnvelopeCipher` (covered by D53) — otherwise reported for a follow-up.
- D57 No schema change expected (sealed blobs are TEXT/JSON). If a vault's column can't hold the change, stop and report.

**Owner actions after merge (before publish):** for each of payments and shipping that is set in Railway runtime-api: copy the current value into `*_KEK_REF_PREVIOUS`, put a NEW random value (same PowerShell command as the email key) into `*_KEK_REF`; publish; check the log line `credential reseal: … failed 0`; then delete `*_KEK_REF_PREVIOUS`. If a variable is not set at all, nothing to do for it.

### Task 1 — sonnet (checkpoints A → B)

**A.** `packages/secrets`: v2 envelope + candidate resolution + v1 compatibility; registry API to expose versions in try-order; tests: v2 has no kekRef; v1 opened while ignoring a hostile embedded kekRef (a v1 envelope whose kekRef points to an attacker key must not open with it); rotation (previous opens, current seals); wrong key everywhere ⇒ generic error; no key material in error messages. Update notifications vault to the shared format only if trivially compatible (else leave, report).
**B.** Payments + shipping vaults persist v2; runtime config + composition for the PREVIOUS envs (secret, optional, documented in `.env.example` and the Railway README); re-seal job (D55) with tests (in-memory repos + a Postgres-gated integration test); boot guard unchanged otherwise; inventory report (D56).
**Commands:** vitest `@platform/secrets`, `@platform/payments`, `@platform/shipping`, `@platform/notifications`, `@platform/licensing`; `@platform/runtime` (composition config api + new reseal tests); tsc for those + admin; arch; tenant scanner; eslint 0 errors and no new warnings (cap 473 in scripts/ops/check-lint-warnings.mjs — keep it).

---

## Opus self-review (round 1)

- Removes the key from storage for all envelope users at once (package-level), and never trusts a stored key reference again, even for old rows.
- Honest about exposure: old KEK values must be treated as leaked ⇒ rotation + re-seal, with the owner steps written down.
- Safe operations: background, single-replica lock, compare-and-set, counts-only logs, idempotent.
  VERDICT: AGREED.
