import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const incidentSeverityEnum = z.enum(["low", "medium", "high", "critical"]);
const complianceFrameworkEnum = z.enum(["gdpr", "soc2", "iso27001", "hipaa", "pci_dss"]);
const controlSeverityEnum = z.enum(["low", "medium", "high", "critical"]);

const openIncidentBody = z.object({
  title: z.string().min(1),
  severity: incidentSeverityEnum,
  category: z.string().min(1),
  reference: z.string().min(1).optional(),
  tenantRef: z.string().min(1).nullable().optional(),
});
const referenceParams = z.object({ reference: z.string().min(1) });
const triageIncidentBody = z.object({
  assignee: z.string().min(1),
  note: z.string().min(1),
});
const incidentNoteBody = z.object({ note: z.string().min(1) });
const resolveIncidentBody = z.object({ resolution: z.string().min(1) });
const addIncidentEvidenceBody = z.object({
  kind: z.string().min(1),
  ref: z.string().min(1),
});

const checkThreatIndicatorBody = z.object({ indicator: z.string().min(1) });

const verifyAuditChainQuery = z.object({ tenantRef: z.string().min(1).optional() });

const evaluateComplianceBody = z.object({
  framework: complianceFrameworkEnum,
  tenantRef: z.string().min(1).nullable().optional(),
  attestations: z
    .object({
      encryptionAtRest: z.boolean().optional(),
      consentTracked: z.boolean().optional(),
      retentionDefined: z.boolean().optional(),
    })
    .optional(),
});
const registerComplianceRuleBody = z.object({
  id: z.string().min(1),
  framework: complianceFrameworkEnum,
  description: z.string().min(1),
  severity: controlSeverityEnum,
});

const tenantRefQuery = z.object({ tenantRef: z.string().min(1).optional() });

/** S1.5.5 — Security Operations admin HTTP surface for Security. Pure delegation. */
export function securityOperationsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/security/incidents",
      version: 1,
      permission: "security:open_incident",
      idempotent: true,
      summary: "Open a security incident",
      schema: { body: openIncidentBody },
      handle: ({ body, context }) => admin.securityOperations.openIncident(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/incidents/:reference/triage",
      version: 1,
      permission: "security:triage_incident",
      idempotent: true,
      summary: "Triage an incident (assign an owner)",
      schema: { params: referenceParams, body: triageIncidentBody },
      handle: ({ params, body, context }) =>
        admin.securityOperations.triageIncident(context.principal, {
          reference: params.reference,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/incidents/:reference/mitigate",
      version: 1,
      permission: "security:mitigate_incident",
      idempotent: true,
      summary: "Mark an incident as being mitigated",
      schema: { params: referenceParams, body: incidentNoteBody },
      handle: ({ params, body, context }) =>
        admin.securityOperations.mitigateIncident(context.principal, {
          reference: params.reference,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/incidents/:reference/resolve",
      version: 1,
      permission: "security:resolve_incident",
      idempotent: true,
      summary: "Resolve an incident",
      schema: { params: referenceParams, body: resolveIncidentBody },
      handle: ({ params, body, context }) =>
        admin.securityOperations.resolveIncident(context.principal, {
          reference: params.reference,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/incidents/:reference/close",
      version: 1,
      permission: "security:close_incident",
      idempotent: true,
      summary: "Close an incident (post-mortem complete)",
      schema: { params: referenceParams, body: incidentNoteBody },
      handle: ({ params, body, context }) =>
        admin.securityOperations.closeIncident(context.principal, {
          reference: params.reference,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/incidents/:reference/evidence",
      version: 1,
      permission: "security:add_incident_evidence",
      summary: "Attach an evidence reference to an incident",
      schema: { params: referenceParams, body: addIncidentEvidenceBody },
      handle: ({ params, body, context }) =>
        admin.securityOperations.addIncidentEvidence(context.principal, {
          reference: params.reference,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/threat-indicators/check",
      version: 1,
      permission: "security:check_threat_indicator",
      summary: "Check an indicator across every registered threat-intel provider",
      schema: { body: checkThreatIndicatorBody },
      handle: ({ body, context }) =>
        admin.securityOperations.checkThreatIndicator(context.principal, body),
    }),
    defineRoute({
      method: "GET",
      path: "/security/audit-chain/verify",
      version: 1,
      permission: "security:verify_audit_chain",
      summary: "Verify the WORM audit ledger's hash chain (tamper evidence) for a tenant scope",
      schema: { querystring: verifyAuditChainQuery },
      handle: ({ query, context }) =>
        admin.securityOperations.verifyAuditChain(context.principal, {
          tenantRef: query.tenantRef ?? null,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/compliance/evaluate",
      version: 1,
      permission: "security:evaluate_compliance",
      summary: "Evaluate a tenant's posture against a compliance framework's rule pack",
      schema: { body: evaluateComplianceBody },
      handle: ({ body, context }) =>
        admin.securityOperations.evaluateCompliance(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/compliance/rules",
      version: 1,
      permission: "security:register_compliance_rule",
      idempotent: true,
      summary: "Register a compliance control into the versioned catalog",
      schema: { body: registerComplianceRuleBody },
      handle: ({ body, context }) =>
        admin.securityOperations.registerComplianceRule(context.principal, body),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/incident-explorer",
      version: 1,
      permission: "security:incident_explorer",
      summary: "Console read model — incident explorer",
      schema: {},
      handle: ({ context }) => admin.securityOperations.incidentExplorer(context.principal),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/audit-explorer",
      version: 1,
      permission: "security:audit_explorer",
      summary: "Console read model — audit explorer, optionally scoped to a tenant",
      schema: { querystring: tenantRefQuery },
      handle: ({ query, context }) =>
        admin.securityOperations.auditExplorer(context.principal, query.tenantRef ?? null),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/dashboard",
      version: 1,
      permission: "security:security_dashboard",
      summary: "Console read model — security dashboard, optionally scoped to a tenant",
      schema: { querystring: tenantRefQuery },
      handle: ({ query, context }) =>
        admin.securityOperations.securityDashboard(context.principal, query.tenantRef ?? null),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/trust-center",
      version: 1,
      permission: "security:trust_center",
      summary: "Console read model — trust center, optionally scoped to a tenant",
      schema: { querystring: tenantRefQuery },
      handle: ({ query, context }) =>
        admin.securityOperations.trustCenter(context.principal, query.tenantRef ?? null),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/analytics",
      version: 1,
      permission: "security:security_analytics",
      summary: "Console read model — security analytics",
      schema: {},
      handle: ({ context }) => admin.securityOperations.securityAnalytics(context.principal),
    }),
  ] as readonly RouteDefinition[];
}
