# Security Hardening Review

> H-5 production hardening review across the deployment surface. This is the operational hardening
> posture; the application-level zero-trust identity/authz/audit machinery is the Security context
> (P2.0) and its H-1…H-4 hardening. Nothing here changes ownership — it configures the edge, the
> image, and the supply chain.

## Transport (TLS)

- Ingress terminates TLS; **TLSv1.3 + TLSv1.2 only** (older protocols disabled).
- `ssl-redirect: true` forces HTTPS; **HSTS** `max-age=63072000; includeSubDomains; preload`.
- Certificates provisioned externally (cert-manager / secret manager) into `runtime-api-tls`; rotate
  per cert lifetime ([BACKUP_AND_RECOVERY §key-rotation](BACKUP_AND_RECOVERY.md#key-rotation)).

## Response headers / CSP

Set at the Ingress ([`60-ingress.yaml`](../../infrastructure/k8s/60-ingress.yaml)) so every response
carries them regardless of the app path. The API is JSON-only, so the CSP is maximally strict:

| Header                                | Value                                                         | Purpose                                     |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `Content-Security-Policy`             | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | no active content is ever served by the API |
| `Strict-Transport-Security`           | `max-age=63072000; includeSubDomains; preload`                | force HTTPS                                 |
| `X-Content-Type-Options`              | `nosniff`                                                     | no MIME sniffing                            |
| `X-Frame-Options`                     | `DENY`                                                        | anti-clickjacking (legacy backstop to CSP)  |
| `Referrer-Policy`                     | `no-referrer`                                                 | no referrer leakage                         |
| `Permissions-Policy`                  | geolocation/camera/microphone/payment `()`                    | deny powerful features                      |
| `Cross-Origin-Opener/Resource-Policy` | `same-origin`                                                 | cross-origin isolation                      |
| `Server`                              | cleared                                                       | reduce fingerprinting                       |

> A storefront/admin UI that serves HTML needs a **looser, page-specific CSP** (script/style
> allowances + nonces). That belongs to the web edge, not this API Ingress — do not copy this policy
> onto an HTML surface verbatim.

## Cookies

The API authenticates with **Bearer tokens (OIDC/JWT)**, not session cookies, so there is no cookie
attack surface on `/api`. Any cookie a UI edge sets must be `Secure`, `HttpOnly`, `SameSite=Lax|Strict`,
host-prefixed (`__Host-`), and short-lived — enforced at that edge, not here.

## Secrets

- No secrets in images, compose, or manifests — sourced from the secret manager / Vault.
- Data-at-rest: envelope encryption (H-3), KMS-held KEK wrapping DEKs; rotation is re-wrap-only.
- CI: gitleaks scans full history each PR; `secret.example.yaml` is a template only.

## Container / workload

- Non-root (`USER node`), read-only root filesystem, `/tmp` tmpfs only.
- `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `RuntimeDefault` seccomp.
- `automountServiceAccountToken: false`; NetworkPolicy restricts pod-to-pod traffic.
- Operational endpoints (`/metrics`, `/healthz`, `/readyz`) are **never** exposed via Ingress.

## Supply chain

| Control           | Mechanism                                     | Workflow                     |
| ----------------- | --------------------------------------------- | ---------------------------- |
| Dependency vulns  | `pnpm audit --prod` (High/Critical fail)      | `security.yml`               |
| Secret leakage    | gitleaks (full history)                       | `security.yml`               |
| Image CVEs        | Trivy (HIGH/CRITICAL, SARIF → Security tab)   | `security.yml`               |
| **SBOM**          | Syft SPDX artifact + buildx SBOM attestation  | `security.yml` / `build.yml` |
| **Provenance**    | buildx provenance attestation (SLSA-style)    | `build.yml`                  |
| **Image signing** | cosign keyless (OIDC, Rekor transparency log) | `release.yml`                |
| Licenses          | `pnpm licenses` inventory artifact            | `security.yml`               |

Verify signature + SBOM attestation before every rollout — see
[DEPLOYMENT_GUIDE](DEPLOYMENT_GUIDE.md#verify-the-image-before-rollout).

## Residual risks / follow-ups

- p95/p99 latency SLIs need OTel histogram buckets (tracked; see [SLO_SLI](SLO_SLI.md)).
- Alertmanager receivers must be wired to the real on-call before go-live.
- WAF / rate-limiting at the edge is recommended in front of `/api` for L7 abuse (out of this repo's scope).
