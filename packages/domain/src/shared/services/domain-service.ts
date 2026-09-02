/**
 * Marker for a domain service — stateless domain behaviour that does not naturally belong to a
 * single entity or value object. Abstraction only; concrete services live in bounded contexts.
 * The phantom member makes the marker nominal (and keeps it a non-empty interface).
 */
export interface DomainService {
  readonly __domainService?: never;
}
