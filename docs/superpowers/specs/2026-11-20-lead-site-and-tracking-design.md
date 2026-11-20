# Lead sites and per-platform tracking: design spec

**Status:** owner decisions recorded 2026-11-20. **Source workbook:** `Morbeh-Tracking-Plan-v4.xlsx` (gaps, maps, 42 official
sources with verbatim quotes, 38 verified expert quotes). Official-source numbers `[n]` below refer to that workbook's
"المصادر الرسمية" sheet.

## Owner decisions (binding)

1. **Site type is chosen once, at sign-up.** Options: `store` (online store) or `lead_site` (lead-generation website).
   Exactly one. **It can never be changed later** — no UI, no merchant API. Existing stores are `store`.
2. **The site type selects the event set.** `store` enables the commerce events; `lead_site` enables exactly
   `page_viewed`, `form_submitted` and `contact_clicked`. The two most important lead events are **form submit** and
   **contact**.
3. **A form submission sends the lead event every time, once per session.** A second submission in the same session
   is saved but not sent to ad platforms; a submission in a new session is sent again. "Session" = the collector's
   session cookie (`SESSION_TTL_SECONDS = 30 * 60`, `packages/tracking/src/collector/collector.ts:126`).
4. **Name, phone and email are always sent, hashed in the format each platform expects** (table below).
5. Purchase fires at order placement; `OrderDelivered` is a custom event at delivery (store mode; later plan).
6. Every event carries a Morbeh event id, identical on the browser pixel and the server API copy.

## Per-platform identity format (normalize → per-platform form → SHA-256 lowercase hex)

| Field                     | Meta [1][8]                 | Snap [15]           | TikTok [9][32]        | Google Ads [20][22]                                            | GA4 MP [23]                            |
| ------------------------- | --------------------------- | ------------------- | --------------------- | -------------------------------------------------------------- | -------------------------------------- |
| email                     | trim+lower, hash            | same                | trim+lower only, hash | lower; gmail.com/googlemail.com: drop dots and `+suffix`; hash | gmail/googlemail: drop dots only; hash |
| phone (`01012345678`, EG) | `201012345678` hash         | `201012345678` hash | `+201012345678` hash  | `+201012345678` hash                                           | `+201012345678` hash                   |
| first/last name           | lower, no punctuation, hash | same                | same, hash            | hash, **only when fn+ln+country+postal all present**           | lower, no digits/symbols, hash         |
| city / state              | hash                        | hash                | **plain**             | plain (address only)                                           | plain                                  |
| country                   | `eg` hash                   | `eg` hash           | `eg` plain            | `EG` plain (address only)                                      | `EG` plain                             |
| postal                    | hash                        | hash                | hash                  | plain (address only)                                           | plain                                  |
| external id               | hash                        | hash                | hash                  | —                                                              | — (user_id)                            |

Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) digits are converted to Latin before any phone normalization. A lead form has
one "name" field: first token = first name, the rest = last name.

## Event ids

`mb_<uuid>` browser-originated events · `lead_<leadId>` form submission · `ord_<orderId>` purchase ·
`dlv_<orderId>` delivered · `cnl_<orderId>` cancelled. The id is the envelope `dedupId`, sent verbatim as Meta
`eventID`/`event_id` [3], TikTok `event_id` [12], Snap `client_dedup_id`/`event_id` [17]. The `session_minute` fallback is
removed because Snap collapses repeated ids [17].

## Delivery order (separate plans)

| Plan                        | Scope                                                                                                        | Branch             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| A — site type in onboarding | `site_type` column + immutable choice at sign-up + sign-up cards + setup guide per type                      | `morbeh/lead-site` |
| B — tracking identity core  | phone/digit/name normalization fixes, per-platform match keys, event ids, once-per-session lead ledger       | `morbeh/lead-site` |
| C — lead form + leads       | `lead_form` section, leads service (honeypot, rate limit), leads inbox, `siteType` gate in storefront        | later              |
| D — delivery wiring         | profile store, click-id capture, per-destination match keys in mapping, browser SDK + pixels, event emission | later              |

## Non-goals (this round)

Lead stages after submission (qualified / converted), Instant-Forms CRM integrations, changing site type.

## Handoff to Plans C and D (binding for those plans; from plan review 1)

- **Event allow-list (C/D):** a resolved `lead_site` shop admits exactly `page_viewed`, `form_submitted`,
  `contact_clicked`; any commerce event is refused before delivery. A `store` shop's behavior is unchanged.
- **Lead route (C):** saves every valid submission; resolves the collector session (minting one with the collector's
  own rules and returning the cookie when missing) **before** calling `decideLeadEmission`; forwards only on `emit`.
  Production ledger: claim = Redis `SET key 1 NX EX 1800`; the collector calls `extendLeadClaim` (Redis `EXPIRE key 1800`,
  never creating the key) on every request of a `lead_site` shop that renews an existing session, so the claim lives
  exactly as long as the session.
- **Ingest (D):** wire `checkProvidedDedupId` — `"invalid"` → permanent refusal `dedup_id_invalid` (value never echoed).
  Remove the `session_minute` fallback only after the browser SDK supplies `mb_<uuid>` on every beacon and queued
  legacy events are drained; never mint an independent random id at ingest. Server events use `businessEventId`.
- **Delivery (D):** per-destination identity from `platformMatchKeys`; the shared `hashIdentity` stops feeding mappings.
