"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  archivePolicy,
  assignRole,
  checkAccess,
  configureTenantSecurity,
  defineRole,
  definePolicy,
  deleteRelationTuple,
  evaluateAccess,
  grantDelegation,
  grantRolePermission,
  publishPolicyVersion,
  registerPermission,
  registerPolicyFragment,
  revokeDelegation,
  revokeRoleAssignment,
  simulatePolicy,
  startImpersonation,
  writeRelationTuple,
  type AccessDecisionOutputDto,
  type AccessModelDecisionDto,
  type IsolationTier,
  type PolicyEffect,
  type PolicyMode,
  type RiskSignalsInput,
  type SecurityScopeInput,
  type TrustSignalsInput,
  type ZeroTrustDecisionDto,
} from "@/lib/api/security";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.12f — Access's write actions: the plan's explicit "policy definition" high-blast-radius
 * category, the last of T5.12's 6 parts. Same `apps/admin-web/README.md` write-screen recipe every
 * prior Phase 5 security task uses: parse `FormData` defensively, mint one `Idempotency-Key` per
 * invocation (constraint #8), call the typed `lib/api/security.ts` function,
 * `revalidatePath("/security/access")` on `ok` (except `simulatePolicyAction`/`checkAccessAction`/
 * `evaluateAccessAction` — preview/explainer tools per their own doc comments in `lib/api/
 * security.ts`, matching every prior part's `checkAiActionAction`/`decideMfaAction`/etc.), otherwise
 * project through `toFormState`.
 */

const POLICY_MODES: readonly PolicyMode[] = ["strict", "balanced", "relaxed", "custom"];
function isPolicyMode(value: string): value is PolicyMode {
  return (POLICY_MODES as readonly string[]).includes(value);
}

const POLICY_EFFECTS: readonly PolicyEffect[] = ["allow", "challenge", "block", "review"];
function isPolicyEffect(value: string): value is PolicyEffect {
  return (POLICY_EFFECTS as readonly string[]).includes(value);
}

const ISOLATION_TIERS: readonly IsolationTier[] = ["pooled", "dedicated_schema", "dedicated_db"];
function isIsolationTier(value: string): value is IsolationTier {
  return (ISOLATION_TIERS as readonly string[]).includes(value);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

/**
 * Parses a newline-separated textarea into a string list — a simpler alternative to Component
 * Library's repeated-input array-of-rows (`components-library/actions.ts`'s `parseStringRows`) for
 * the plain string lists this domain's routes take (`permissions`, `allowedAuthMethods`): no
 * per-item structure (unlike Component Library's `{name,type,required}` property rows), so one line
 * per entry is enough. Drops blank lines.
 */
function parseLines(formData: FormData, name: string): readonly string[] {
  return stringField(formData, name)
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Builds `{organization,tenant,workspace,environment}` from 4 optional fields, or `undefined` if every one is blank. */
function optionalScope(formData: FormData): SecurityScopeInput | undefined {
  const organization = optionalStringField(formData, "scopeOrganization");
  const tenant = optionalStringField(formData, "scopeTenant");
  const workspace = optionalStringField(formData, "scopeWorkspace");
  const environment = optionalStringField(formData, "scopeEnvironment");
  if (
    organization === undefined &&
    tenant === undefined &&
    workspace === undefined &&
    environment === undefined
  ) {
    return undefined;
  }
  return { organization, tenant, workspace, environment };
}

type JsonFieldResult =
  | { readonly present: false }
  | { readonly present: true; readonly ok: true; readonly value: unknown }
  | { readonly present: true; readonly ok: false };

/**
 * Parses a raw-JSON textarea field. Unlike `components-library/actions.ts`'s `parseDefaults` (which
 * requires a plain object), this accepts *any* JSON value — `PolicyExpression`/`PolicyCondition`
 * (the domain's recursive expression-language types behind `when`/`expr`/`expression`/`abac`, all
 * `z.unknown()` on the backend) are not restricted to plain objects. Re-validates defensively what
 * the client-side check in the matching form component should already have caught.
 */
function parseJsonField(formData: FormData, name: string): JsonFieldResult {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return { present: false };
  try {
    return { present: true, ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { present: true, ok: false };
  }
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

// ── Roles ────────────────────────────────────────────────────────────────────────────────────────

/** Defines a role in the registry — a standalone create form (idempotent per key). */
export async function defineRoleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const key = stringField(formData, "key").trim();
  const name = stringField(formData, "name").trim();
  const permissions = parseLines(formData, "permissions");
  const parentKey = optionalStringField(formData, "parentKey");
  const isTemplate = formData.get("isTemplate") === "on";
  const scope = optionalScope(formData);

  const fieldErrors: Record<string, string> = {};
  if (key.length === 0) fieldErrors["key"] = t.invalid;
  if (name.length === 0) fieldErrors["name"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await defineRole(
    {
      key,
      name,
      scope,
      permissions: permissions.length > 0 ? permissions : undefined,
      parentKey,
      isTemplate,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Grants a permission to a role — a per-row control on the permission explorer's Roles table.
 * `roleKey` is re-derived from the submitted `FormData` (a per-row hidden field), same discipline
 * `refreshSessionAction` (T5.12e) documents for its own per-row field.
 */
export async function grantRolePermissionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const roleKey = stringField(formData, "roleKey").trim();
  const permission = stringField(formData, "permission").trim();

  const fieldErrors: Record<string, string> = {};
  if (roleKey.length === 0) fieldErrors["roleKey"] = t.invalid;
  if (permission.length === 0) fieldErrors["permission"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await grantRolePermission(roleKey, permission, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Assigns a role to a principal — a standalone form. `grantedBy` (the audit actor) is submitted as
 * plain form data, pre-filled client-side from the current admin user (`AssignRoleForm`), same
 * pattern Feature Flags' `changedBy` uses.
 */
export async function assignRoleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const roleKey = stringField(formData, "roleKey").trim();
  const grantedBy = stringField(formData, "grantedBy").trim();
  const reason = optionalStringField(formData, "reason");
  const scope = optionalScope(formData);
  const ttlSecondsRaw = optionalStringField(formData, "ttlSeconds");
  const ttlSeconds = ttlSecondsRaw === undefined ? undefined : Number.parseInt(ttlSecondsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (principalExternalId.length === 0) fieldErrors["principalExternalId"] = t.invalid;
  if (roleKey.length === 0) fieldErrors["roleKey"] = t.invalid;
  if (grantedBy.length === 0) fieldErrors["grantedBy"] = t.invalid;
  if (ttlSeconds !== undefined && (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)) {
    fieldErrors["ttlSeconds"] = t.invalid;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await assignRole(
    { principalExternalId, roleKey, grantedBy, scope, ttlSeconds, reason },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Revokes a role assignment — a standalone form. Confirmed client-side before submit (constraint #10). */
export async function revokeRoleAssignmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const assignmentId = stringField(formData, "assignmentId").trim();
  if (assignmentId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { assignmentId: t.invalid } };
  }

  const result = await revokeRoleAssignment(assignmentId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

// ── Policies ─────────────────────────────────────────────────────────────────────────────────────

/** Defines a policy in the Policy Registry — a standalone form (idempotent per key; starts draft). `mode` is a fixed 4-value enum. */
export async function definePolicyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const key = stringField(formData, "key").trim();
  const name = stringField(formData, "name").trim();
  const modeRaw = stringField(formData, "mode").trim();

  const fieldErrors: Record<string, string> = {};
  if (key.length === 0) fieldErrors["key"] = t.invalid;
  if (name.length === 0) fieldErrors["name"] = t.invalid;
  if (!isPolicyMode(modeRaw)) fieldErrors["mode"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await definePolicy({ key, name, mode: modeRaw as PolicyMode }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Publishes a new immutable policy version and activates it — a per-row control on the Policies
 * table. `rules` is a raw JSON textarea (an array of `{id, description, when, expr?, effect}` rule
 * objects, `when`/`expr` themselves the backend's own `z.unknown()` fields) — never a structured
 * per-rule editor, per the task brief. Confirmed client-side before submit, naming the exact policy
 * key (constraint #10) — see `PublishPolicyVersionRowForm`.
 */
export async function publishPolicyVersionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const policyKey = stringField(formData, "policyKey").trim();
  const defaultEffectRaw = optionalStringField(formData, "defaultEffect");
  const rulesField = parseJsonField(formData, "rules");

  const fieldErrors: Record<string, string> = {};
  if (policyKey.length === 0) fieldErrors["policyKey"] = t.invalid;
  if (
    !rulesField.present ||
    !rulesField.ok ||
    !Array.isArray(rulesField.value) ||
    rulesField.value.length === 0
  ) {
    fieldErrors["rules"] = t.invalid;
  }
  if (defaultEffectRaw !== undefined && !isPolicyEffect(defaultEffectRaw)) {
    fieldErrors["defaultEffect"] = t.invalid;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const rules = (rulesField as { readonly ok: true; readonly value: unknown }).value as readonly unknown[];
  const result = await publishPolicyVersion(
    policyKey,
    rules,
    defaultEffectRaw === undefined ? undefined : (defaultEffectRaw as PolicyEffect),
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Archives a policy — a per-row control on the Policies table. Confirmed before submit (constraint #10). */
export async function archivePolicyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const policyKey = stringField(formData, "policyKey").trim();
  if (policyKey.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { policyKey: t.invalid } };
  }

  const result = await archivePolicy(policyKey, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Simulate policy" preview panel renders — never routed through `toFormState`. */
export type SimulatePolicyFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly decision: ZeroTrustDecisionDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Simulates a policy's active version against a hypothetical context — "(read-only)" per the
 * route's own summary despite being a POST, a pure what-if per the task brief. Standalone preview
 * panel with a manually-typed `policyKey`. Never `revalidatePath`s.
 */
export async function simulatePolicyAction(
  _previous: SimulatePolicyFormState,
  formData: FormData,
): Promise<SimulatePolicyFormState> {
  const t = await formErrorDictionary();

  const policyKey = stringField(formData, "policyKey").trim();
  if (policyKey.length === 0) {
    return { status: "error", message: t.invalid };
  }

  const riskRaw = optionalStringField(formData, "risk");
  const trustRaw = optionalStringField(formData, "trust");
  const result = await simulatePolicy(
    policyKey,
    {
      principalActive: formData.get("principalActive") === "on",
      sessionValid: formData.get("sessionValid") === "on",
      permissionGranted: formData.get("permissionGranted") === "on",
      deviceTrusted: formData.get("deviceTrusted") === "on",
      risk: riskRaw === undefined ? undefined : Number(riskRaw),
      trust: trustRaw === undefined ? undefined : Number(trustRaw),
      environment: optionalStringField(formData, "environment") ?? null,
      resource: optionalStringField(formData, "resource") ?? null,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", decision: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

// ── ReBAC relations ──────────────────────────────────────────────────────────────────────────────

/** Writes a ReBAC relation tuple — a standalone form (idempotent by key). */
export async function writeRelationTupleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const namespace = stringField(formData, "namespace").trim();
  const object = stringField(formData, "object").trim();
  const relation = stringField(formData, "relation").trim();
  const subject = stringField(formData, "subject").trim();

  const fieldErrors: Record<string, string> = {};
  if (namespace.length === 0) fieldErrors["namespace"] = t.invalid;
  if (object.length === 0) fieldErrors["object"] = t.invalid;
  if (relation.length === 0) fieldErrors["relation"] = t.invalid;
  if (subject.length === 0) fieldErrors["subject"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await writeRelationTuple(
    { namespace, object, relation, subject },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Removes a ReBAC relation tuple by its 4 components — a standalone form. Confirmed client-side
 * before submit (constraint #10).
 */
export async function deleteRelationTupleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const namespace = stringField(formData, "namespace").trim();
  const object = stringField(formData, "object").trim();
  const relation = stringField(formData, "relation").trim();
  const subject = stringField(formData, "subject").trim();

  const fieldErrors: Record<string, string> = {};
  if (namespace.length === 0) fieldErrors["namespace"] = t.invalid;
  if (object.length === 0) fieldErrors["object"] = t.invalid;
  if (relation.length === 0) fieldErrors["relation"] = t.invalid;
  if (subject.length === 0) fieldErrors["subject"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await deleteRelationTuple(
    { namespace, object, relation, subject },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

// ── Access checks (preview panels) ──────────────────────────────────────────────────────────────

/** What the "Check access" preview panel renders — never routed through `toFormState`. */
export type CheckAccessFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly decision: AccessModelDecisionDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Runs the unified authorization check (RBAC + ReBAC + ABAC) — a preview/explainer tool per the
 * task brief. `abac` is the backend's `z.unknown()` field, a raw JSON textarea. Never
 * `revalidatePath`s.
 */
export async function checkAccessAction(
  _previous: CheckAccessFormState,
  formData: FormData,
): Promise<CheckAccessFormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const permission = stringField(formData, "permission").trim();
  if (principalExternalId.length === 0 || permission.length === 0) {
    return { status: "error", message: t.invalid };
  }

  const abacField = parseJsonField(formData, "abac");
  if (abacField.present && !abacField.ok) {
    return { status: "error", message: t.invalid };
  }

  const result = await checkAccess(
    {
      principalExternalId,
      permission,
      scope: optionalScope(formData),
      namespace: optionalStringField(formData, "namespace"),
      object: optionalStringField(formData, "object"),
      relation: optionalStringField(formData, "relation"),
      abac: abacField.present && abacField.ok ? abacField.value : undefined,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", decision: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

/** What the "Evaluate access" preview panel renders — never routed through `toFormState`. */
export type EvaluateAccessFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly decision: AccessDecisionOutputDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Runs the zero-trust access evaluation — "the platform's single authorization entry point" per
 * its own route summary. A preview/explainer panel per the task brief (see `evaluateAccess`'s doc
 * comment in `lib/api/security.ts`). Never `revalidatePath`s.
 */
export async function evaluateAccessAction(
  _previous: EvaluateAccessFormState,
  formData: FormData,
): Promise<EvaluateAccessFormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const permission = stringField(formData, "permission").trim();
  if (principalExternalId.length === 0 || permission.length === 0) {
    return { status: "error", message: t.invalid };
  }

  const failedAuthCountRaw = optionalStringField(formData, "failedAuthCount");
  const ipReputationRaw = optionalStringField(formData, "ipReputation");
  const sessionAgeDaysRaw = optionalStringField(formData, "sessionAgeDays");
  const risk: RiskSignalsInput = {
    failedAuthCount: failedAuthCountRaw === undefined ? undefined : Number(failedAuthCountRaw),
    newDevice: formData.get("newDevice") === "on",
    impossibleTravel: formData.get("impossibleTravel") === "on",
    threatIntelHit: formData.get("threatIntelHit") === "on",
    ipReputation: ipReputationRaw === undefined ? undefined : Number(ipReputationRaw),
  };
  const trust: TrustSignalsInput = {
    deviceTrusted: formData.get("deviceTrusted") === "on",
    mfaSatisfied: formData.get("mfaSatisfied") === "on",
    sessionAgeDays: sessionAgeDaysRaw === undefined ? undefined : Number(sessionAgeDaysRaw),
    knownGoodPrincipal: formData.get("knownGoodPrincipal") === "on",
  };

  const result = await evaluateAccess(
    {
      principalExternalId,
      permission,
      sessionId: optionalStringField(formData, "sessionId"),
      resource: optionalStringField(formData, "resource"),
      scope: optionalScope(formData),
      environment: optionalStringField(formData, "environment"),
      deviceRef: optionalStringField(formData, "deviceRef"),
      policyKey: optionalStringField(formData, "policyKey"),
      risk,
      trust,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", decision: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

// ── Registries ───────────────────────────────────────────────────────────────────────────────────

/**
 * Registers a reusable, versioned policy fragment — a standalone form. `expression` is a raw JSON
 * textarea (the backend's own `z.unknown()` field).
 */
export async function registerPolicyFragmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const key = stringField(formData, "key").trim();
  const description = optionalStringField(formData, "description");
  const expressionField = parseJsonField(formData, "expression");

  const fieldErrors: Record<string, string> = {};
  if (key.length === 0) fieldErrors["key"] = t.invalid;
  if (!expressionField.present || !expressionField.ok) fieldErrors["expression"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await registerPolicyFragment(
    {
      key,
      description,
      expression: (expressionField as { readonly ok: true; readonly value: unknown }).value,
    },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Registers a permission definition into the discoverable, versioned catalog — a standalone form. */
export async function registerPermissionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const permission = stringField(formData, "permission").trim();
  const description = stringField(formData, "description").trim();

  const fieldErrors: Record<string, string> = {};
  if (permission.length === 0) fieldErrors["permission"] = t.invalid;
  if (description.length === 0) fieldErrors["description"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await registerPermission({ permission, description }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

// ── Delegations & impersonation ──────────────────────────────────────────────────────────────────

/** Grants a delegation (one principal may act as another, time-boxed) — a standalone form. */
export async function grantDelegationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const delegatorExternalId = stringField(formData, "delegatorExternalId").trim();
  const delegateExternalId = stringField(formData, "delegateExternalId").trim();
  const permissions = parseLines(formData, "permissions");
  const reason = optionalStringField(formData, "reason");
  const scope = optionalScope(formData);
  const ttlSecondsRaw = optionalStringField(formData, "ttlSeconds");
  const ttlSeconds = ttlSecondsRaw === undefined ? undefined : Number.parseInt(ttlSecondsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (delegatorExternalId.length === 0) fieldErrors["delegatorExternalId"] = t.invalid;
  if (delegateExternalId.length === 0) fieldErrors["delegateExternalId"] = t.invalid;
  if (ttlSeconds !== undefined && (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)) {
    fieldErrors["ttlSeconds"] = t.invalid;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await grantDelegation(
    {
      delegatorExternalId,
      delegateExternalId,
      scope,
      permissions: permissions.length > 0 ? permissions : undefined,
      ttlSeconds,
      reason,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Revokes a delegation — a standalone form. Confirmed before submit (constraint #10). */
export async function revokeDelegationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const delegationId = stringField(formData, "delegationId").trim();
  if (delegationId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { delegationId: t.invalid } };
  }

  const result = await revokeDelegation(delegationId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Start impersonation" panel renders. `impersonation` carries the fresh session details, shown exactly once. */
export type StartImpersonationFormState =
  | { readonly status: "idle" }
  | {
      readonly status: "success";
      readonly impersonation: {
        readonly sessionId: string;
        readonly actingAs: string;
        readonly impersonatedBy: string;
        readonly expiresAt: string;
      };
    }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/**
 * Starts an impersonation session under an active delegation — **the single highest-risk
 * individual action in this entire phase** per the task brief. `delegatorExternalId`/
 * `delegateExternalId` are collected purely as admin-typed, display-only context for the client
 * component's own unmistakable confirmation dialog (`StartImpersonationForm`); this action never
 * forwards them to `startImpersonation()` — only `delegationId` (the sole identifier the route
 * actually takes) reaches the wire. `confirmDelegationId` is the server-side half of the
 * type-the-delegation-id-to-confirm friction step: the client already gates the submit button on
 * this match, and this action re-checks it defensively (same "never trust the client alone"
 * discipline `parseJsonField` documents for its own client-checked textareas) rather than silently
 * trusting a bypassed client check.
 */
export async function startImpersonationAction(
  _previous: StartImpersonationFormState,
  formData: FormData,
): Promise<StartImpersonationFormState> {
  const t = await formErrorDictionary();

  const delegationId = stringField(formData, "delegationId").trim();
  const confirmDelegationId = stringField(formData, "confirmDelegationId").trim();
  const refreshFingerprint = stringField(formData, "refreshFingerprint").trim();
  const ttlSecondsRaw = optionalStringField(formData, "ttlSeconds");
  const ttlSeconds = ttlSecondsRaw === undefined ? Number.NaN : Number.parseInt(ttlSecondsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (delegationId.length === 0) fieldErrors["delegationId"] = t.invalid;
  if (confirmDelegationId !== delegationId) fieldErrors["confirmDelegationId"] = t.invalid;
  if (refreshFingerprint.length === 0) fieldErrors["refreshFingerprint"] = t.invalid;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) fieldErrors["ttlSeconds"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await startImpersonation(
    delegationId,
    { refreshFingerprint, ttlSeconds },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success", impersonation: result.data };
  }
  const formState = toFormState(result, t);
  return formState as Extract<StartImpersonationFormState, { readonly status: "error" }>;
}

// ── Tenant security ──────────────────────────────────────────────────────────────────────────────

/** Configures (or reconfigures) a tenant's security profile — a standalone form (idempotent create-or-patch). */
export async function configureTenantSecurityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const tenantRef = stringField(formData, "tenantRef").trim();
  const isolationTierRaw = optionalStringField(formData, "isolationTier");
  const securityModeRaw = optionalStringField(formData, "securityMode");
  const residencyRegion = optionalStringField(formData, "residencyRegion");
  const mfaRequired = formData.get("mfaRequired") === "on";
  const allowedAuthMethods = parseLines(formData, "allowedAuthMethods");
  const defaultPolicyKey = optionalStringField(formData, "defaultPolicyKey");

  const fieldErrors: Record<string, string> = {};
  if (tenantRef.length === 0) fieldErrors["tenantRef"] = t.invalid;
  if (isolationTierRaw !== undefined && !isIsolationTier(isolationTierRaw)) {
    fieldErrors["isolationTier"] = t.invalid;
  }
  if (securityModeRaw !== undefined && !isPolicyMode(securityModeRaw)) {
    fieldErrors["securityMode"] = t.invalid;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await configureTenantSecurity(
    tenantRef,
    {
      isolationTier: isolationTierRaw as IsolationTier | undefined,
      residencyRegion,
      securityMode: securityModeRaw as PolicyMode | undefined,
      mfaRequired,
      allowedAuthMethods: allowedAuthMethods.length > 0 ? allowedAuthMethods : undefined,
      defaultPolicyKey,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/access");
    return { status: "success" };
  }
  return toFormState(result, t);
}
