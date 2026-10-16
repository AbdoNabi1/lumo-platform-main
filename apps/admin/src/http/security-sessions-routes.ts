import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const authMethodKindEnum = z.enum([
  "password",
  "passkey",
  "magic_link",
  "otp",
  "email_verification",
  "phone_verification",
  "oauth",
  "oidc",
  "saml",
  "ldap",
  "enterprise_sso",
]);
const mfaMethodKindEnum = z.enum(["totp", "webauthn", "sms_otp", "email_otp", "backup_code"]);
const riskBandEnum = z.enum(["low", "moderate", "elevated", "high"]);
const signalSeverityEnum = z.enum(["low", "medium", "high"]);

const establishSessionBody = z.object({
  principalExternalId: z.string().min(1),
  refreshFingerprint: z.string().min(1),
  externalRef: z.string().min(1).nullable().optional(),
  deviceRef: z.string().min(1).nullable().optional(),
  ttlSeconds: z.number().int().positive(),
});
const sessionIdParams = z.object({ sessionId: z.string().min(1) });
const refreshSessionBody = z.object({
  newRefreshFingerprint: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
});
const principalExternalIdParams = z.object({ externalId: z.string().min(1) });

const registerAuthMethodBody = z.object({
  kind: authMethodKindEnum,
  displayName: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string()).optional(),
});
const authenticateBody = z.object({
  method: authMethodKindEnum,
  identifier: z.string().min(1),
  credential: z.string().optional(),
  deviceFingerprint: z.string().optional(),
  ip: z.string().optional(),
  sensitiveAction: z.boolean().optional(),
  rememberDevice: z.boolean().optional(),
  mfaSatisfied: z.boolean().optional(),
  sessionTtlSeconds: z.number().int().positive().optional(),
  metadata: z.record(z.string()).optional(),
});

const registerDeviceBody = z.object({
  fingerprint: z.string().min(1),
  principalExternalId: z.string().min(1).optional(),
  tenantRef: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string()).optional(),
});
const fingerprintParams = z.object({ fingerprint: z.string().min(1) });
const recordDeviceSignalBody = z.object({
  type: z.string().min(1),
  severity: signalSeverityEnum,
});

const enrollMfaBody = z.object({
  principalExternalId: z.string().min(1),
  method: mfaMethodKindEnum,
});
const enrollmentIdParams = z.object({ enrollmentId: z.string().min(1) });
const verifyMfaBody = z.object({ code: z.string().min(1) });
const generateBackupCodesBody = z.object({ count: z.number().int().positive().optional() });
const decideMfaBody = z.object({
  principalExternalId: z.string().min(1),
  deviceFingerprint: z.string().optional(),
  riskBand: riskBandEnum,
  sensitiveAction: z.boolean().optional(),
  rememberDevice: z.boolean().optional(),
});
const registerMfaMethodBody = z.object({
  kind: mfaMethodKindEnum,
  displayName: z.string().min(1),
  enabled: z.boolean().optional(),
});
const evaluateRiskBody = z.object({
  principalExternalId: z.string().min(1).optional(),
  ip: z.string().optional(),
  deviceFingerprint: z.string().optional(),
});

/** S1.5.2 — Sessions & Authentication admin HTTP surface for Security. Pure delegation. */
export function securitySessionsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/security/sessions",
      version: 1,
      permission: "security:establish_session",
      idempotent: true,
      summary: "Establish an authenticated session for a principal",
      schema: { body: establishSessionBody },
      handle: ({ body, context }) =>
        admin.securitySessions.establishSession(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/sessions/:sessionId/refresh",
      version: 1,
      permission: "security:refresh_session",
      idempotent: true,
      summary: "Rotate the refresh token and extend the session",
      schema: { params: sessionIdParams, body: refreshSessionBody },
      handle: ({ params, body, context }) =>
        admin.securitySessions.refreshSession(context.principal, {
          tenantId: context.tenantId,
          sessionId: params.sessionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/sessions/:sessionId/revoke",
      version: 1,
      permission: "security:revoke_session",
      idempotent: true,
      summary: "Revoke a session (logout / forced revocation)",
      schema: { params: sessionIdParams },
      handle: ({ params, context }) =>
        admin.securitySessions.revokeSession(context.principal, {
          tenantId: context.tenantId,
          sessionId: params.sessionId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/sessions/:sessionId/introspect",
      version: 1,
      permission: "security:introspect_session",
      summary: "Read-only session validity check at the current clock",
      schema: { params: sessionIdParams },
      handle: ({ params, context }) =>
        admin.securitySessions.introspectSession(context.principal, {
          tenantId: context.tenantId,
          sessionId: params.sessionId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/principals/:externalId/sessions/revoke-all",
      version: 1,
      permission: "security:revoke_all_sessions",
      idempotent: true,
      summary: "Revoke every active session for a principal (force logout everywhere)",
      schema: { params: principalExternalIdParams },
      handle: ({ params, context }) =>
        admin.securitySessions.revokeAllSessions(context.principal, {
          tenantId: context.tenantId,
          principalExternalId: params.externalId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/auth-methods",
      version: 1,
      permission: "security:register_auth_method",
      idempotent: true,
      summary: "Register/update an authentication method in the Registry Engine",
      schema: { body: registerAuthMethodBody },
      handle: ({ body, context }) =>
        admin.securitySessions.registerAuthMethod(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/authenticate",
      version: 1,
      permission: "security:authenticate",
      summary: "The provider-agnostic authenticate() flow",
      schema: { body: authenticateBody },
      handle: ({ body, context }) =>
        admin.securitySessions.authenticate(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/devices",
      version: 1,
      permission: "security:register_device",
      idempotent: true,
      summary: "Register a device (idempotent per fingerprint; starts untrusted)",
      schema: { body: registerDeviceBody },
      handle: ({ body, context }) =>
        admin.securitySessions.registerDevice(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/devices/:fingerprint/signals",
      version: 1,
      permission: "security:record_device_signal",
      summary: "Record a device security signal (lowers reputation, counts anomalies)",
      schema: { params: fingerprintParams, body: recordDeviceSignalBody },
      handle: ({ params, body, context }) =>
        admin.securitySessions.recordDeviceSignal(context.principal, {
          tenantId: context.tenantId,
          fingerprint: params.fingerprint,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/devices/:fingerprint/trust",
      version: 1,
      permission: "security:trust_device",
      idempotent: true,
      summary: "Explicitly trust a device (remember-device)",
      schema: { params: fingerprintParams },
      handle: ({ params, context }) =>
        admin.securitySessions.trustDevice(context.principal, {
          tenantId: context.tenantId,
          fingerprint: params.fingerprint,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/devices/:fingerprint/block",
      version: 1,
      permission: "security:block_device",
      idempotent: true,
      summary: "Block a device",
      schema: { params: fingerprintParams },
      handle: ({ params, context }) =>
        admin.securitySessions.blockDevice(context.principal, {
          tenantId: context.tenantId,
          fingerprint: params.fingerprint,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/mfa/enrollments",
      version: 1,
      permission: "security:enroll_mfa",
      idempotent: true,
      summary: "Enroll a principal in an MFA method",
      schema: { body: enrollMfaBody },
      handle: ({ body, context }) =>
        admin.securitySessions.enrollMfa(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/mfa/enrollments/:enrollmentId/verify",
      version: 1,
      permission: "security:verify_mfa_enrollment",
      idempotent: true,
      summary: "Verify a submitted MFA code; activates a pending enrollment",
      schema: { params: enrollmentIdParams, body: verifyMfaBody },
      handle: ({ params, body, context }) =>
        admin.securitySessions.verifyMfaEnrollment(context.principal, {
          tenantId: context.tenantId,
          enrollmentId: params.enrollmentId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/mfa/enrollments/:enrollmentId/backup-codes",
      version: 1,
      permission: "security:generate_backup_codes",
      summary: "Generate one-time backup codes (returned once)",
      schema: { params: enrollmentIdParams, body: generateBackupCodesBody },
      handle: ({ params, body, context }) =>
        admin.securitySessions.generateBackupCodes(context.principal, {
          tenantId: context.tenantId,
          enrollmentId: params.enrollmentId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/mfa/enrollments/:enrollmentId/revoke",
      version: 1,
      permission: "security:revoke_mfa",
      idempotent: true,
      summary: "Revoke an MFA enrollment",
      schema: { params: enrollmentIdParams },
      handle: ({ params, context }) =>
        admin.securitySessions.revokeMfa(context.principal, {
          tenantId: context.tenantId,
          enrollmentId: params.enrollmentId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/mfa/decide",
      version: 1,
      permission: "security:decide_mfa",
      summary: "Decide the MFA requirement for a request (read-only)",
      schema: { body: decideMfaBody },
      handle: ({ body, context }) =>
        admin.securitySessions.decideMfa(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/mfa/methods",
      version: 1,
      permission: "security:register_mfa_method",
      idempotent: true,
      summary: "Register/update an MFA method definition",
      schema: { body: registerMfaMethodBody },
      handle: ({ body, context }) =>
        admin.securitySessions.registerMfaMethod(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/risk/evaluate",
      version: 1,
      permission: "security:evaluate_risk",
      summary: "Evaluate request risk via the Risk Engine (explainable factors)",
      schema: { body: evaluateRiskBody },
      handle: ({ body, context }) =>
        admin.securitySessions.evaluateRisk(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/session-explorer",
      version: 1,
      permission: "security:session_explorer",
      summary: "Console read model — session explorer",
      schema: {},
      handle: ({ context }) =>
        admin.securitySessions.sessionExplorer(context.principal, context.tenantId),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/device-explorer",
      version: 1,
      permission: "security:device_explorer",
      summary: "Console read model — device explorer",
      schema: {},
      handle: ({ context }) =>
        admin.securitySessions.deviceExplorer(context.principal, context.tenantId),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/risk-explorer",
      version: 1,
      permission: "security:risk_explorer",
      summary: "Console read model — risk explorer",
      schema: {},
      handle: ({ context }) => admin.securitySessions.riskExplorer(context.principal),
    }),
  ] as readonly RouteDefinition[];
}
