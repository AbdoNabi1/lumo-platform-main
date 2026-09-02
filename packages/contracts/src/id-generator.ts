/**
 * Outbound port for generating unique identifiers. Implemented by infrastructure
 * (`@platform/id`'s `CryptoIdGenerator`) and wired into the application via DI (the `ID_GENERATOR`
 * token lives in `@platform/application`).
 *
 * The domain never depends on this — when creating new aggregates the application generates an
 * id and passes it in (`UniqueEntityId.from(idGenerator.generate())`); repositories rehydrate
 * existing aggregates via `UniqueEntityId.from(persistedId)`.
 */
export interface IdGenerator {
  generate(): string;
}
