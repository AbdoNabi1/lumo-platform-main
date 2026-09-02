# 07 — Authentication and authorization

> **Status: CONTRACT — 2026-06-28.** Defines authentication for every principal and the
> authorization model.

## 1. Authentication

Self-hosted **Ory** (Kratos identities, Hydra OAuth2/OIDC). Auth0 acceptable as interim.

| Principal          | Method                                                                                               | Sessions / tokens                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Customer           | OIDC; passwordless primary (magic link + OTP); passkeys (WebAuthn); social (Google, Apple, Facebook) | HTTP-only Secure cookies, `SameSite=Lax`, device-bound; access JWT RS256 15 min; opaque refresh 30 d, rotated, server-revocable |
| Operator (admin)   | SSO (SAML/OIDC via Okta/Azure AD); MFA required (TOTP min, WebAuthn preferred)                       | 4-hour absolute, 30-min idle; step-up for sensitive actions                                                                     |
| Service-to-service | mTLS in-cluster (SPIFFE/cert-manager); JWT RS256 fallback                                            | short-lived                                                                                                                     |
| Partner / API      | OAuth2 client-credentials; scoped API keys (rotatable, leak-detected); PATs for devs                 | scoped                                                                                                                          |

- **MFA** is required at sensitive boundaries (change email/payment, refunds, data export, permission grants) via **step-up** even within an active session — not on every login (friction kills conversion).
- Every auth event (login, token issue, permission check, step-up) is written to the immutable audit log (doc 13/14).

## 2. Authorization — RBAC + ReBAC hybrid

- **RBAC** for coarse roles: `owner`, `admin`, `merchandiser`, `cs_agent`, `finance`, `analyst`, `developer`, `read_only`. (The admin Permissions screen reflects these.)
- **ReBAC** (Zanzibar via Ory Keto / OpenFGA) for fine-grained relationships: "user X is member of household Y", "team Z owns collection C", "agent S has time-bound access to order O for ticket T".

### Permission shape

| Level    | Example                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| Module   | `catalog:read`, `orders:refund`                                                   |
| Resource | `product:{id}:edit`, `order:{id}:refund`                                          |
| Field    | `customer.email:read` (support) vs `customer.payment_methods:read` (finance only) |

### Customer-side authorization

- **Household** is a permission boundary: parents manage child profiles; gift-givers get scoped, time-bound wishlist access.
- **B2B/school accounts** are first-class: buyer, approver, accountant roles within one account.

## 3. Enforcement and audit

- Authorization is enforced at the gateway (coarse) and in the application layer per resource/field (fine). Field-level auth is part of the GraphQL resolver contract.
- Every permission check logs subject, object, action, decision, policy version.
- Quarterly automated access reviews ("who can do what").

## 4. Child-data special handling

Child profiles are never an authentication subject and never used for cross-household authorization
or analytics. Access requires the owning parent's verified consent (COPPA/GDPR-K; see doc 14).

## Requires ADR to change

- The identity provider (Ory) or the token strategy.
- The RBAC role set or the RBAC+ReBAC hybrid model.
