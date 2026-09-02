import { ValueObject } from "@platform/domain";

export interface SynonymEntry {
  readonly term: string;
  readonly synonyms: readonly string[];
}

/** Merchant-authored index configuration — synonyms, facet/sortable fields, and autocomplete suggestions. Configuration only; the actual index lives behind `IndexProviderPort` (ADR-0020). */
export class IndexConfig extends ValueObject<{
  readonly synonyms: readonly SynonymEntry[];
  readonly facetFields: readonly string[];
  readonly sortableFields: readonly string[];
  readonly suggestions: readonly string[];
}> {
  static default(): IndexConfig {
    return new IndexConfig({ synonyms: [], facetFields: [], sortableFields: [], suggestions: [] });
  }

  static create(
    synonyms: readonly SynonymEntry[],
    facetFields: readonly string[],
    sortableFields: readonly string[],
    suggestions: readonly string[],
  ): IndexConfig {
    return new IndexConfig({ synonyms, facetFields, sortableFields, suggestions });
  }

  withSynonym(term: string, synonyms: readonly string[]): IndexConfig {
    const filtered = this.props.synonyms.filter((entry) => entry.term !== term);
    return new IndexConfig({ ...this.props, synonyms: [...filtered, { term, synonyms }] });
  }

  withoutSynonym(term: string): IndexConfig {
    return new IndexConfig({
      ...this.props,
      synonyms: this.props.synonyms.filter((entry) => entry.term !== term),
    });
  }

  withSuggestion(term: string): IndexConfig {
    if (this.props.suggestions.includes(term)) return this;
    return new IndexConfig({ ...this.props, suggestions: [...this.props.suggestions, term] });
  }

  get synonyms(): readonly SynonymEntry[] {
    return this.props.synonyms;
  }

  get facetFields(): readonly string[] {
    return this.props.facetFields;
  }

  get sortableFields(): readonly string[] {
    return this.props.sortableFields;
  }

  get suggestions(): readonly string[] {
    return this.props.suggestions;
  }
}
