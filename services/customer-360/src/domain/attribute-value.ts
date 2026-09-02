/**
 * The value a computed attribute can hold. Deliberately a **local** type, not a reuse of
 * `@platform/expression`'s `Scalar` — `domain/` may depend only on the shared kernel
 * (`domain-stays-pure`, dependency-cruiser: `@platform/types`/`@platform/utils`/`@platform/domain`
 * only), never on `@platform/expression` or `@platform/rules`, both of which the rule/expression
 * engine that actually *produces* this value legitimately depends on at the ports/application layer
 * (`ports/computed-attribute-definition.ts`). The two types happen to be structurally identical
 * today (both `string | number | boolean | null`) for the same reason `ProfileFieldConfidence` and
 * `@platform/tracking`'s `IdentityConfidence` happen to both be two-valued: coincidence of shape, not
 * of meaning — coupling them would mean an unrelated future change to the expression kernel's value
 * model silently changes what a computed attribute is allowed to hold.
 */
export type AttributeValue = string | number | boolean | null;
