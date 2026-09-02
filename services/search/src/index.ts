export { wireSearch } from "./composition";
export type { SearchWiringDeps, WiredSearch } from "./composition";
export { SearchController } from "./interfaces/search.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { SearchIndex } from "./domain/search-index";
export type { SearchIndexRepository } from "./domain/search-index-repository";
export type { IndexProviderPort } from "./application/ports";
export {
  PrismaSearchIndexRepository,
  type PrismaSearchIndexRepositoryDeps,
} from "./infrastructure/prisma-search-index-repository";
export { SEARCH_PUBLISHED_EVENTS } from "./infrastructure/search-event-translator";
