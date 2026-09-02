import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface SeoProps {
  readonly title: string | null;
  readonly description: string | null;
}

/** Optional SEO overrides for a product's listing. Either field may be absent. */
export class Seo extends ValueObject<SeoProps> {
  static create(title?: string, description?: string): Result<Seo, ValidationError> {
    if (title !== undefined && title.trim().length === 0) {
      return err(
        new ValidationError("Invalid SEO", [{ field: "title", message: "must not be blank" }]),
      );
    }
    if (description !== undefined && description.trim().length === 0) {
      return err(
        new ValidationError("Invalid SEO", [
          { field: "description", message: "must not be blank" },
        ]),
      );
    }
    return ok(new Seo({ title: title ?? null, description: description ?? null }));
  }

  get title(): string | null {
    return this.props.title;
  }

  get description(): string | null {
    return this.props.description;
  }
}
