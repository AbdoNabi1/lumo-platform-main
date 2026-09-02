/**
 * A coarse permission, formatted `"<module>:<action>"` — e.g. `"orders:refund"`, `"products:edit"`
 * (docs/architecture/07). Resource- and field-level (ReBAC) authorization is a future addition;
 * this is the Phase-1 RBAC granularity.
 */
export type Permission = string;
