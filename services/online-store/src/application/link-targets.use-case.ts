import {
  LINK_TARGET_QUERY_MAX,
  POLICY_SLUGS,
  POLICY_TITLES,
  POLICY_TYPES,
  policyPath,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { invalidContent } from "../domain/errors";
import type { OnlineStoreDeps } from "./deps";
import type { CatalogLinkType, LinkTargetChoice } from "./ports";

/** The link picker's answer and query bounds (spec 2.2, plan Rulings). */
export const LINK_TARGET_RESULTS_MAX = 20;
export { LINK_TARGET_QUERY_MAX };

const CATALOG_LINK_TYPES: readonly CatalogLinkType[] = ["collection", "product", "page"];

export interface SearchLinkTargetsInput {
  readonly type: CatalogLinkType | "policy";
  readonly q: string;
  readonly tenantId: string;
}

/** The menu editor's link picker: policies are answered here, the rest by the link-target port. */
export class SearchLinkTargets {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(
    input: SearchLinkTargetsInput,
  ): Promise<Result<{ readonly targets: LinkTargetChoice[] }, DomainError>> {
    const query = (typeof input.q === "string" ? input.q : "")
      .trim()
      .slice(0, LINK_TARGET_QUERY_MAX);
    if (input.type === "policy") return ok({ targets: policyChoices(query) });
    const type = CATALOG_LINK_TYPES.find((kind) => kind === input.type);
    if (type === undefined) return err(invalidContent([{ path: "type", code: "INVALID_VALUE" }]));
    const found = await this.deps.linkTargets.search(type, query, input.tenantId);
    return ok({
      targets: found
        .slice(0, LINK_TARGET_RESULTS_MAX)
        .map((choice) => ({ id: choice.id, title: choice.title, subtitle: choice.subtitle })),
    });
  }
}

/** Matched case-insensitively against the slug and both titles; an empty query lists all five. */
function policyChoices(query: string): LinkTargetChoice[] {
  const needle = query.toLowerCase();
  return POLICY_TYPES.filter((type) =>
    [POLICY_SLUGS[type], POLICY_TITLES[type].en, POLICY_TITLES[type].ar].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  ).map((type) => ({ id: type, title: POLICY_TITLES[type].en, subtitle: policyPath(type) }));
}
