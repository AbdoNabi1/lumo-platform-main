import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

export const MAX_DESCRIPTION_LENGTH = 20_000;
export const MAX_PRODUCT_TYPE_LENGTH = 255;
export const MAX_TAG_LENGTH = 255;
export const MAX_TAGS = 250;

interface ProductDetailsProps {
  readonly description: string | null;
  readonly productType: string | null;
  readonly tags: readonly string[];
}

/**
 * Plan 2C-1: Shopify's descriptive product fields. `description` is PLAIN TEXT (line breaks
 * kept); rich text with an HTML sanitizer is Plan 2C-2, and until then nothing renders it as HTML.
 */
export class ProductDetails extends ValueObject<ProductDetailsProps> {
  static empty(): ProductDetails {
    return new ProductDetails({ description: null, productType: null, tags: [] });
  }

  static create(input: {
    readonly description: string | null;
    readonly productType: string | null;
    readonly tags: readonly string[];
  }): Result<ProductDetails, ValidationError> {
    const issues: { field: string; message: string }[] = [];
    const description = blankToNull(input.description);
    if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
      issues.push({
        field: "description",
        message: `must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      });
    }
    const productType = blankToNull(input.productType);
    if (productType !== null && productType.length > MAX_PRODUCT_TYPE_LENGTH) {
      issues.push({
        field: "productType",
        message: `must be at most ${MAX_PRODUCT_TYPE_LENGTH} characters`,
      });
    }
    const tags = normalizeTags(input.tags);
    if (tags.length > MAX_TAGS) {
      issues.push({ field: "tags", message: `must have at most ${MAX_TAGS} tags` });
    }
    if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
      issues.push({
        field: "tags",
        message: `each tag must be at most ${MAX_TAG_LENGTH} characters`,
      });
    }
    if (issues.length > 0) return err(new ValidationError("Invalid product details", issues));
    return ok(new ProductDetails({ description, productType, tags }));
  }

  get description(): string | null {
    return this.props.description;
  }

  get productType(): string | null {
    return this.props.productType;
  }

  get tags(): readonly string[] {
    return this.props.tags;
  }
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Trims, drops blanks, and drops case-insensitive duplicates keeping the first spelling (Shopify). */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.length === 0) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}
