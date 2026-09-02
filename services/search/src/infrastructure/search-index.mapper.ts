import { UniqueEntityId } from "@platform/domain";
import { SearchIndex } from "../domain/search-index";
import { IndexConfig, type SynonymEntry } from "../domain/value-objects/index-config";
import { IndexStatus, type IndexStatusValue } from "../domain/value-objects/index-status";

export interface SearchIndexRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly synonyms: readonly SynonymEntry[];
  readonly facetFields: readonly string[];
  readonly sortableFields: readonly string[];
  readonly suggestions: readonly string[];
  readonly documentCount: number;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link SearchIndex}. Mapping only — no I/O. */
export class SearchIndexMapper {
  static toDomain(row: SearchIndexRow): SearchIndex {
    return SearchIndex.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      IndexStatus.from(row.status as IndexStatusValue),
      IndexConfig.create(row.synonyms, row.facetFields, row.sortableFields, row.suggestions),
      row.documentCount,
      row.version,
    );
  }

  static toRow(index: SearchIndex, tenantId: string) {
    return {
      id: index.id.toString(),
      tenantId,
      name: index.name,
      status: index.status.value,
      synonyms: index.config.synonyms,
      facetFields: index.config.facetFields,
      sortableFields: index.config.sortableFields,
      suggestions: index.config.suggestions,
      documentCount: index.documentCount,
      version: 1,
    };
  }
}
