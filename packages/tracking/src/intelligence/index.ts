// Area barrel. Extracted from the package barrel when it crossed the FF-CX-01 600-line budget:
// grouping exports by area keeps each list readable and makes the package barrel a table of
// contents rather than a wall. export * is safe here because FF-API-01 now resolves star
// re-exports through the TypeScript compiler, so every symbol behind this line is individually
// guarded (it was not, under the old regex extractor).
// --- Event Intelligence (P5.5 / P8) ---------------------------------------
export type {
  DiffKind,
  DiffSeverity,
  FieldChange,
  DestinationChange,
  VersionChange,
  EventDiff,
  DiffSide,
} from "./event-diff";
export { diffEvents } from "./event-diff";
