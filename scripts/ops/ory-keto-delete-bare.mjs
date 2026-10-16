#!/usr/bin/env node
// G-70 step 3 of 3 — delete the bare Keto tuples. REFUSES (exit 1) unless the count gate passes,
// evaluated by this script on a fresh listing (not trusting an earlier run). DRY-RUN by default;
// nothing is deleted without --apply.
//
//   ORY_SDK_URL=… ORY_API_KEY=… node scripts/ops/ory-keto-delete-bare.mjs --tenant <tenantId> [--apply]
//
// Run it only AFTER the reads have been switched (objectFor returns the qualified object) and the
// count gate has passed. Runbook: docs/operations/KETO_TENANT_MIGRATION.md.
import { cliMain, runDeleteBare } from "./keto-tenant-tuples.mjs";

process.exitCode = await cliMain(runDeleteBare);
