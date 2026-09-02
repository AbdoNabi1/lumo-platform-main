# 14 — Security

> **Status: CONTRACT — 2026-06-28.** Defines the security posture. Security and child-data
> protection are first-class architectural constraints.

## 1. Threat model (primary)

Account takeover, payment fraud, PII/child-data exposure, broken authorization (IDOR), injection,
SSRF via integrations, secret leakage, supply-chain compromise, abusive bots/scraping.

## 2. Data protection

| Class | Control |
|---|---|
| Children's data | Encrypted at rest with a per-household key; isolated store; never in analytics/tracking; verified parental consent (COPPA/GDPR-K); cryptographic erasure on deletion |
| PII | Encryption at rest; hashing before any third-party forward; redaction in logs; consent-gated processing |
| Payments | No PAN stored; PSP tokenization; PCI scope minimized to the vault boundary |
| Behavioral | Consent-respecting; retention-capped; erasable |
| Secrets | Vault only, short-lived leases, automated rotation, no secrets in Git/images/env files |

Encryption in transit (TLS 1.2+ everywhere, mTLS in-cluster) and at rest (DB, object storage, backups).

## 3. Application security

- **AuthZ everywhere:** object-level checks on every resource access (no IDOR); field-level auth in resolvers (doc 07).
- **Input validation at every boundary** (zod/schema) — never trust client input; output encoding to prevent XSS; parameterized queries / ORM to prevent injection.
- **CSRF**: SameSite cookies + token checks on state-changing requests; **SSRF**: allowlist outbound integration egress.
- **Rate limiting + bot management** at the edge (Cloudflare); abuse/leaked-credential detection.
- **Step-up auth** for sensitive operations (refunds, exports, permission grants) (doc 07).
- Secure headers (CSP, HSTS, etc.) on storefront/admin.

## 4. Privacy and compliance

- **COPPA / GDPR-K / GDPR / CCPA** by design: consent capture is an immutable, time-stamped, per-category, per-jurisdiction log; data-subject requests (access, deletion, portability) are first-class flows; data minimization is enforced (collect only what's needed).
- No behavioral profiling of minors anywhere in the system (tracking, analytics, marketing, recommendations).
- Consent state propagates with events; non-consented data is dropped at capture (doc 09).

## 5. Infrastructure and supply-chain security

- **Least privilege** IAM; network segmentation; private subnets for data stores; zero-trust service mesh (mTLS/SPIFFE).
- **Supply chain:** pinned dependencies, SBOM, dependency/secret scanning in CI, signed images, admission control; no installing unreviewed packages.
- **IaC security:** Terraform plan scanning; no manual prod changes (GitOps only, doc 15).
- **Secrets in CI** via short-lived OIDC, never long-lived keys.

## 6. Auditing and response

- Immutable, WORM audit log (separate store) for every auth event, permission check/decision, and sensitive data access, with policy version.
- Security monitoring/alerting integrated with observability (doc 13).
- Incident response runbooks; quarterly access reviews; periodic penetration testing; restore drills (doc 15).

## Requires ADR to change

- The child-data isolation/encryption model or any control that touches COPPA/GDPR-K compliance.
- The no-PAN-storage rule, secrets-in-Vault-only rule, or zero-trust mesh requirement.
