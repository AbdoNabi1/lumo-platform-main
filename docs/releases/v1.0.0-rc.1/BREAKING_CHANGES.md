# Breaking Changes — v1.0.0-rc.1

## Summary

**None to application APIs or data.** This is the first tagged release; there is no prior published
version to break compatibility with, and H-5 is additive (packaging, monitoring, docs, CI) — no
runtime code paths, contracts, event schemas, or database schemas changed.

## Operational changes that require action before rollout

These are **not** API breaks, but they are deployment behaviors that change how you operate the
platform. Treat them as go-live prerequisites.

| Change                                                                       | Impact                                                              | Action                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Images are now **cosign-signed** and `deploy.yml` **verifies** the signature | An unsigned/foreign digest fails the deploy gate                    | Only deploy digests produced by `release.yml`; verify per [DEPLOYMENT_GUIDE](../../operations/DEPLOYMENT_GUIDE.md) |
| Ingress now sets **HSTS + strict CSP** on `/api`                             | Clients are pinned to HTTPS; the strict CSP suits the JSON API only | Do **not** reuse this CSP on an HTML surface; ensure valid TLS certs are provisioned                               |
| Prometheus now scrapes the runtime `/metrics` and loads **alerting rules**   | New Alertmanager routing is active                                  | Wire real Alertmanager receivers (PagerDuty/Slack) before relying on paging                                        |
| Deploy pins images **by digest** (never a tag)                               | Tag-based deploys are no longer the path                            | Use the `image_digest` input to `deploy.yml`                                                                       |

## Forward-compatibility guarantees from 1.0.0

Once 1.0.0 GA ships, the project follows semver:

- **MAJOR** — incompatible API/contract/schema changes (documented here with migrations).
- **MINOR** — backward-compatible features.
- **PATCH** — backward-compatible fixes.

Database migrations remain **expand → migrate → contract** so N and N-1 app versions stay compatible
across a rollout window (see [UPGRADE_GUIDE](../../operations/UPGRADE_GUIDE.md)).
