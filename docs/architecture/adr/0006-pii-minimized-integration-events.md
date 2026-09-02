# ADR-0006: Integration events carry no raw PII (data minimization)

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (platform-hardening review)
- **Affected documents:** 14, 19, 20

## Context

`identity.customer.registered.v1` published the customer's raw `email` and `name` in its payload
— contradicting its own catalog row (doc 20 §4: `customer_id, household_id, source`) and
creating a GDPR problem: integration events are long-retained (13mo/7y per doc 20) and, once a
broker exists, effectively immutable. Erasure (GDPR Art. 17) against append-only topics that
contain raw PII means crypto-shredding or topic rewrites — a project nobody chose. The logging
foundation had the same exposure: redaction was opt-in and shallow, so one
`logger.info("event", { payload })` would leak PII to logs.

## Decision

1. **Integration-event payloads carry identifiers, not PII.** The Identity translator publishes
   `{ customerId }` for `customer.registered`; consumers needing profile details fetch them from
   the owning context by id. The rule applies platform-wide: the translator (the anti-corruption
   boundary between domain events and the wire) is where minimization happens — domain events may
   keep rich data for in-process use.
2. **The kernel logger redacts by default**: a built-in sensitive-key list (credentials + direct
   PII such as `email`, `phone`, card fields), matched case- and separator-insensitively,
   applied recursively (cycle-safe, depth-bounded). Callers may extend the list; disabling the
   defaults is an explicit opt-out.

## Consequences

- **Positive:** erasure stays an Identity-context concern (delete/anonymize rows), not a broker
  rewrite; logs are safe by default rather than by discipline.
- **Negative / trade-offs:** consumers pay a lookup for profile data (correct coupling — the
  owning context stays the source of truth); over-eager default redaction may occasionally mask
  a benign field (opt-out exists).
- **Follow-ups:** apply the same review to future events at design time (checklist item in the
  events catalog); the encrypted-PII-at-rest decision (doc 14 §2) remains scheduled with real
  persistence.

## Alternatives considered

- **Per-customer encryption keys on event payloads (crypto-shredding)** — viable, heavyweight;
  unnecessary when the payload simply does not need the PII.
- **Keep PII and rely on retention limits** — rejected: 13-month retention exceeds any
  reasonable erasure SLA.
