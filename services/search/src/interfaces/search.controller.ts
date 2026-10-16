import type { GetIndex } from "../application/get-index.use-case";
import type { ListIndexes, ListIndexesInput } from "../application/list-indexes.use-case";
import type {
  AddSuggestion,
  AddSynonym,
  AdvanceIndex,
  AdvanceIndexInput,
  CreateIndex,
  CreateIndexInput,
  DeleteDocument,
  DeleteDocumentInput,
  IndexIdInput,
  LogQuery,
  LogQueryInput,
  RemoveSynonym,
  SuggestionInput,
  SynonymInput,
  UpsertDocument,
  UpsertDocumentInput,
} from "../application/search.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface SearchControllerDeps {
  readonly createIndex: CreateIndex;
  readonly advanceIndex: AdvanceIndex;
  readonly upsertDocument: UpsertDocument;
  readonly deleteDocument: DeleteDocument;
  readonly addSynonym: AddSynonym;
  readonly removeSynonym: RemoveSynonym;
  readonly addSuggestion: AddSuggestion;
  readonly logQuery: LogQuery;
  readonly listIndexes: ListIndexes;
  readonly getIndex: GetIndex;
}

/** Framework-agnostic interface boundary for search use-cases (no HTTP server). */
export class SearchController {
  private readonly deps: SearchControllerDeps;

  constructor(deps: SearchControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateIndexInput): Promise<ControllerResponse> {
    return present(await this.deps.createIndex.execute(input), 201);
  }

  async advance(input: AdvanceIndexInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceIndex.execute(input), 200);
  }

  async upsertDocument(input: UpsertDocumentInput): Promise<ControllerResponse> {
    return present(await this.deps.upsertDocument.execute(input), 200);
  }

  async deleteDocument(input: DeleteDocumentInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteDocument.execute(input), 200);
  }

  async addSynonym(input: SynonymInput): Promise<ControllerResponse> {
    return present(await this.deps.addSynonym.execute(input), 200);
  }

  async removeSynonym(input: SynonymInput): Promise<ControllerResponse> {
    return present(await this.deps.removeSynonym.execute(input), 200);
  }

  async addSuggestion(input: SuggestionInput): Promise<ControllerResponse> {
    return present(await this.deps.addSuggestion.execute(input), 200);
  }

  async logQuery(input: LogQueryInput): Promise<ControllerResponse> {
    return present(await this.deps.logQuery.execute(input), 200);
  }

  async list(input: ListIndexesInput): Promise<ControllerResponse> {
    return present(await this.deps.listIndexes.execute(input), 200);
  }

  async get(input: IndexIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getIndex.execute(input), 200);
  }
}
