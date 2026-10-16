#!/usr/bin/env node
// G-70 step 2 of 3 — the safety interlock, not a report. Counts bare vs tenant-qualified Keto tuples
// per permission and per subject and exits NON-ZERO unless they match exactly. A bare tuple with no
// qualified twin fails closed once the bare tuples are deleted (it locks the seeded operator out of
// the console). READ-ONLY: it never writes, so it takes no --apply and always talks to the project.
//
//   ORY_SDK_URL=… ORY_API_KEY=… node scripts/ops/ory-keto-count-gate.mjs --tenant <tenantId>
//
// Exit 0 = match (or already contracted); 1 = mismatch / empty namespace; 2 = usage or Ory error.
// Runbook: docs/operations/KETO_TENANT_MIGRATION.md.
import { cliMain, runCountGate } from "./keto-tenant-tuples.mjs";

process.exitCode = await cliMain(runCountGate);
