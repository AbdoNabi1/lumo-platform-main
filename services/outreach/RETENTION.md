# Outreach retention (Part 1)

These are **proposed defaults**, requiring owner confirmation before real traffic. The deletion job is deferred to Part 4; these periods are not automatically enforced in Part 1. The platform operator owns deletion, including tenant deletion requests.

| Stored customer-text field | Purpose                                                                               | Proposed retention  | Deletion owner    |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------- | ----------------- |
| Inbound `text`             | Process and respond to inbound messages, including opt-out keywords                   | 180 days            | Platform operator |
| Consent `evidence`         | Legal evidence of the consent action                                                  | Life of the contact | Platform operator |
| Status `raw`               | Diagnose delivery status; only status, timestamp and error code/title are allowlisted | 90 days             | Platform operator |

Full provider payloads and arbitrary error text are never stored. No metrics are implemented in Part 1.

## Part 4 backlog

- Counters without sensitive labels.
- Callback-inbox backlog visibility without sensitive labels.
- Unresolved-attempt age visibility without sensitive labels.
- Implement retention deletion jobs.

## Pending owner smoke checks

- Session-window expiry prevents session dispatch.
- Consent or token revocation: zero dispatch while authorization is invalid.
