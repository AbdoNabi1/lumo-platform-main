# WP-9 — Marketing campaigns and the integrations hub

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** WP-6 (real notification delivery). Benefits from WP-4 (attribution) and WP-2/WP-3.
> **Conflicts with:** WP-3, WP-5, WP-6, WP-7, WP-10 (`composition.ts`) and WP-4, WP-5, WP-6, WP-8 (`admin-routes.ts`).
> **Closes:** G-55.

## Why this exists

Two admin screens currently render an honest "this does not exist" state, and both are telling the
truth:

- `apps/admin-web/src/app/marketing/page.tsx` — _"no `services/marketing` context, no campaign
  aggregate anywhere in the codebase — only a bare `campaignRef` string on Coupon/Promotion with no
  owning data."_ Re-audited at T5.14 and unchanged.
- `apps/admin-web/src/app/integrations/page.tsx` — `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` reads
  `Status: CONTRACT … No application code`.

**Do not delete either screen until the thing it describes exists.** Replace them in the same change
that makes them untrue.

## What already exists and must not be rebuilt

This is the WP where duplication is most likely, because the tracking package already contains half
of what "integrations" means.

`packages/tracking/src/delivery/platform-profiles.ts` already defines, as seeded data:

| Destination key | Endpoint                                                | Credential ref                         |
| --------------- | ------------------------------------------------------- | -------------------------------------- |
| `meta.capi`     | Meta Conversions API                                    | `vault://tracking/meta/access_token`   |
| `google.ads`    | `googleads.googleapis.com/v18/…:uploadClickConversions` | `vault://tracking/google/access_token` |
| (GA4)           | `google-analytics.com/mp/collect`                       | —                                      |
| `tiktok.events` | `business-api.tiktok.com/open_api/v1.3/event/track/`    | `vault://tracking/tiktok/access_token` |
| (Snapchat)      | `tr.snapchat.com/v3/{pixel_id}/events`                  | —                                      |

…plus `SEED_MAPPING_PROFILES` mapping envelope fields to each platform's payload (including
`user_data.fbp` / `fbc` / `gclid` click-id bindings), a `DestinationAdapter` interface, an
`HttpJsonAdapter`, a router, retry/rate-limit/circuit-breaker descriptors, and a
`DestinationStatus` lifecycle (`draft | published | deprecated | archived`).

**So server-side conversion delivery to the ad platforms is largely built.** What is missing is the
operator-facing half: connecting an account, storing its credentials, and seeing whether delivery is
working. There are also **no tracking admin routes at all** — `ls apps/admin/src/http/ | grep -i track`
returns nothing — so none of this is reachable or observable by a merchant.

## Part A — Marketing

- [ ] **T9.1 — `services/marketing`.**
      Generate the context with `pnpm gen` (the service generator exists — read `turbo/generators`
      and use it rather than hand-rolling the directory layout).
      `Campaign` aggregate: name, objective, channels, schedule, budget (minor units), status
      lifecycle, and the audience it targets — expressed as a reference to a
      `services/customer-360` segment, **by id, never by importing the context**.
      `campaignRef` on Coupon and Promotion becomes a reference to a real campaign. Migrating
      existing opaque strings is part of this task, not an afterthought: decide what happens to a
      `campaignRef` pointing at nothing (leave it, orphaned, and make the read tolerate it) and
      write that decision down.

- [ ] **T9.2 — Campaign execution reuses WP-6.**
      A campaign send **is** an automation run: audience → message → schedule. Do not build a second
      sender, a second scheduler or a second consent check. `services/marketing` owns the campaign
      concept; `services/automation` executes it. If that requires a port between them, add one.

- [ ] **T9.3 — Campaign performance.**
      Sends, deliveries, opens/clicks where the provider reports them, attributed revenue from WP-4.
      If WP-4 has not landed, show sends and deliveries and state plainly that revenue attribution
      is unavailable — do not divide a total by campaign count and call it attribution.

- [ ] **T9.4 — Replace the marketing screen.**
      Campaign list, detail, create/edit. Delete the honest-gap comment **and** the gap register
      entry in the same change.

## Part B — Integrations hub

- [ ] **T9.5 — Read the contract first.**
      `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` in full. It is a contract-only spec that explicitly
      states this is a net-new operator surface. Implement what it specifies; where it is silent,
      make the decision and record it in the spec (changing its `Status:` line from `CONTRACT`).

- [ ] **T9.6 — The connection registry.**
      A `Connection` aggregate: provider key, status (`disconnected | connecting | connected |
error`), account identifiers, scopes granted, last-sync time, last error.
      Credentials go in `packages/secrets` — **never** in a Postgres column, never in a log, never
      in a DTO. The `vault://` refs already in `platform-profiles.ts` show the intended shape;
      follow it.

- [ ] **T9.7 — OAuth connect flows.**
      For each ad platform: an authorize redirect, a callback that exchanges the code, token storage
      via `packages/secrets`, and refresh before expiry.
      Security requirements, none optional: a signed `state` parameter bound to the tenant and
      verified on callback (this is the CSRF boundary of the whole feature); exact redirect-URI
      matching; and the narrowest scope set that works. Note G-6 (headers/CSRF) is an open gap —
      do not add a new unprotected callback surface to it.

- [ ] **T9.8 — Wire connections to the existing destinations.**
      A connected Meta account populates the credential the `meta.capi` destination already reads,
      and flips that destination from `draft` to `published` in the registry. This task is _wiring_,
      not new delivery code. If you find yourself writing an HTTP call to Meta, stop — `HttpJsonAdapter`
      and the mapping profile already do it.

- [ ] **T9.9 — Tracking admin routes and a delivery observability screen.**
      There are none today. Add read routes over the existing destination registry, mapping profiles
      and the delivery/inspector records (`packages/tracking/src/inspector/`), then a screen showing:
      per-destination delivery success rate, recent failures with their reason, circuit-breaker
      state, and a single-event inspector. Without this, server-side tracking fails silently, which
      is the worst possible failure mode for a system whose entire job is to not lose events.

- [ ] **T9.10 — Product feeds.**
      Google Merchant Center, Meta Catalog, TikTok Catalog. Generate from published catalog data
      with per-platform field mapping; serve at a stable, tenant-scoped URL; regenerate on catalog
      change. Only published, in-stock-eligible products. Feed validity is testable — assert
      required fields per platform in a test rather than discovering rejections in the platform's UI.

- [ ] **T9.11 — Replace the integrations screen.** Same rule as T9.4.

## Definition of done

- [ ] A campaign can be created, targeted at a real segment, scheduled, executed through WP-6, and
      its sends reported.
- [ ] An operator connects a Meta (or Google) account via OAuth and sees `connected`.
- [ ] A connected account's credential feeds the existing destination, and events deliver to the
      real platform — verified against the platform's own event-received tooling, not just a 200.
- [ ] The delivery observability screen shows real success/failure counts.
- [ ] A product feed validates against its platform's required fields.
- [ ] Neither honest-gap screen remains, and both comments are removed with them.
- [ ] No credential appears in Postgres, a log, a DTO or an error message. Prove it with a test.
- [ ] G-55 closed; `03-INTEGRATIONS_HUB_SPEC.md`'s status updated. Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **The biggest risk in this WP is building a parallel delivery stack.** Read
  `packages/tracking/src/delivery/` end to end before writing any platform-specific code. If your
  diff contains a URL that is already in `platform-profiles.ts`, you are duplicating.
- **A leaked ad-account token is a financial loss**, not just a data breach — it can spend the
  merchant's budget. Treat credential handling as the highest-severity part of the work.
- **Do not send PII to an ad platform unhashed.** `packages/tracking/src/pipeline/hashing.ts`
  exists for exactly this; Meta CAPI and Google Ads both require hashed user data.
- **Rate limits differ per platform and per endpoint.** `RateLimitDescriptor` and
  `CircuitBreakerDescriptor` already exist on the destination definitions — configure them, do not
  reimplement them.
