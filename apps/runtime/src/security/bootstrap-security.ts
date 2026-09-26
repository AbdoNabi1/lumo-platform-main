/**
 * The baseline moved to `@platform/security` (T10.6): per-tenant provisioning (`apps/admin`) and the
 * runtime's boot path must run the SAME function, and `apps/admin` cannot import `apps/runtime`.
 * Re-exported here so the consumers and tests that named this module keep one import path.
 */
export {
  BASELINE_POLICY_KEY,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_SERVICE_ROLE,
  SYSTEM_GRANTOR,
  bootstrapSecurity,
  type SecurityBootstrapSummary,
} from "@platform/security";
