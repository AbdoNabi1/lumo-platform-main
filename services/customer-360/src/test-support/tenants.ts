/** Two fixed tenant ids for tests. Every store/use-case call takes an explicit `tenantId` (ADR-0014),
 * so tests use these instead of a construction-time pin; `TENANT_B` exists to prove isolation. */
export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";
