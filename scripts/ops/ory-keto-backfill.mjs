#!/usr/bin/env node
// G-70 step 1 of 3 — write a tenant-qualified twin (`tenant/<tenantId>/<permission>`) for every
// bare Keto grant that lacks one. DRY-RUN by default; nothing is written without --apply.
//
//   ORY_SDK_URL=… ORY_API_KEY=… node scripts/ops/ory-keto-backfill.mjs --tenant <tenantId> [--apply]
//
// `--tenant` is required and has no default: it is the tenant every EXISTING bare grant belongs to
// (today's single tenant — the runtime's TENANT_DEFAULT_ID). Idempotent. Runbook:
// docs/operations/KETO_TENANT_MIGRATION.md.
import { cliMain, runBackfill } from "./keto-tenant-tuples.mjs";

process.exitCode = await cliMain(runBackfill);
