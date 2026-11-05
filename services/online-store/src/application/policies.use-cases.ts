import {
  isPolicyType,
  LOCALES,
  normalizeLocalizedText,
  RICH_TEXT_MAX,
  validateRichText,
  type ContentIssue,
  type Locale,
  type LocalizedText,
  type PolicyType,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { invalidContent, policyNotFound, versionConflict } from "../domain/errors";
import { renderPolicyTemplate } from "../domain/policy-templates/render";
import { readTemplateInputs } from "../domain/policy-templates/template-inputs";
import type { StorePolicy } from "../domain/store-policy";
import type { OnlineStoreDeps } from "./deps";
import { inUnitOfWork, iso } from "./guarded";

export interface PolicyView {
  readonly type: PolicyType;
  readonly body: LocalizedText;
  readonly updatedAt: string | null;
  readonly version: number;
}

export interface PolicySummary {
  readonly type: PolicyType;
  readonly set: boolean;
  readonly locales: Locale[];
  readonly updatedAt: string | null;
}

export interface PublicPolicyView {
  readonly type: PolicyType;
  readonly body: LocalizedText;
  readonly updatedAt: string | null;
}

/** A copy that lists its fields, so nothing else on a stored body can ride along. */
function bodyOf(body: LocalizedText): LocalizedText {
  return {
    ...(body.ar === undefined ? {} : { ar: body.ar }),
    ...(body.en === undefined ? {} : { en: body.en }),
  };
}

/** Admin view. Lists its fields: the staff id (`updatedBy`) never leaves the service. */
function viewOf(policy: StorePolicy, version: number): PolicyView {
  const s = policy.snapshot();
  return { type: s.type, body: bodyOf(s.body), updatedAt: iso(s.updatedAt), version };
}

export class ListPolicies {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<{ readonly policies: PolicySummary[] }, DomainError>> {
    const policies = await this.deps.policies.list(input.tenantId);
    return ok({
      policies: policies.map((policy) => ({
        type: policy.snapshot().type,
        set: policy.isSet,
        locales: [...policy.locales],
        updatedAt: iso(policy.snapshot().updatedAt),
      })),
    });
  }
}

export class GetPolicy {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly type: PolicyType;
    readonly tenantId: string;
  }): Promise<Result<PolicyView, DomainError>> {
    if (!isPolicyType(input.type)) return err(policyNotFound());
    const policy = await this.deps.policies.get(input.type, input.tenantId);
    return ok(viewOf(policy, policy.snapshot().version));
  }
}

export interface UpdatePolicyInput {
  readonly type: PolicyType;
  readonly body: unknown;
  readonly expectedVersion: number;
  readonly by: string;
  readonly tenantId: string;
}

/**
 * Saves the text of one policy (spec 2.3). Everything is validated before the unit of work writes
 * anything: `run` commits whenever the callback returns, even an `err` Result.
 */
export class UpdatePolicy {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: UpdatePolicyInput): Promise<Result<PolicyView, DomainError>> {
    if (!isPolicyType(input.type)) return err(policyNotFound());
    const issues: ContentIssue[] = [];
    const body = normalizeLocalizedText(
      input.body,
      { path: "body", max: RICH_TEXT_MAX.body, multiline: true },
      issues,
    );
    for (const locale of LOCALES) {
      const text = body[locale];
      if (text === undefined || issues.some((issue) => issue.path === `body.${locale}`)) continue;
      if (validateRichText(text, RICH_TEXT_MAX.body).some((i) => i.code === "UNSAFE_LINK")) {
        issues.push({ path: `body.${locale}`, code: "UNSAFE_LINK" });
      }
    }
    if (issues.length > 0) return err(invalidContent(issues));
    return inUnitOfWork(this.deps, async (tx) => {
      const policy = await this.deps.policies.get(input.type, input.tenantId, tx);
      if (policy.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = policy.nextVersion;
      policy.update(body, input.by, this.deps.clock.now());
      await this.deps.policies.save(policy, input.tenantId, tx);
      return ok(viewOf(policy, version));
    });
  }
}

/** Pure: no tenant and no repository. The text goes to the editor and is never saved here. */
export class GeneratePolicyTemplate {
  execute(input: {
    readonly type: PolicyType;
    readonly locale: Locale;
    readonly inputs: unknown;
  }): Result<{ readonly body: string }, DomainError> {
    const issues: ContentIssue[] = [];
    if (!isPolicyType(input.type)) issues.push({ path: "type", code: "INVALID_VALUE" });
    if (!(LOCALES as readonly string[]).includes(input.locale)) {
      issues.push({ path: "locale", code: "INVALID_VALUE" });
    }
    const read = readTemplateInputs(input.inputs);
    if (!read.ok) issues.push(...read.issues);
    if (issues.length > 0 || !read.ok) return err(invalidContent(issues));
    return ok({ body: renderPolicyTemplate(input.type, input.locale, read.value) });
  }
}

/** Public: a policy that is not set is `null`; only the listed fields are returned. */
export class GetPublicPolicy {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly type: PolicyType;
    readonly tenantId: string;
  }): Promise<PublicPolicyView | null> {
    if (!isPolicyType(input.type)) return null;
    const policy = await this.deps.policies.get(input.type, input.tenantId);
    if (!policy.isSet) return null;
    const s = policy.snapshot();
    return { type: s.type, body: bodyOf(s.body), updatedAt: iso(s.updatedAt) };
  }
}
