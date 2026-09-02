import { ValueObject } from "@platform/domain";

interface SearchDocumentProps {
  readonly productRef: string;
  readonly title: string;
  readonly categoryRefs: readonly string[];
  readonly attributes: Readonly<Record<string, string>>;
}

/** A product **snapshot** indexed via `IndexProviderPort` — Catalog remains the source of truth; Search never owns product data. */
export class SearchDocument extends ValueObject<SearchDocumentProps> {
  static create(
    productRef: string,
    title: string,
    categoryRefs: readonly string[],
    attributes: Readonly<Record<string, string>> = {},
  ): SearchDocument {
    return new SearchDocument({ productRef, title, categoryRefs, attributes });
  }

  get productRef(): string {
    return this.props.productRef;
  }

  get title(): string {
    return this.props.title;
  }

  get categoryRefs(): readonly string[] {
    return this.props.categoryRefs;
  }

  get attributes(): Readonly<Record<string, string>> {
    return this.props.attributes;
  }
}
