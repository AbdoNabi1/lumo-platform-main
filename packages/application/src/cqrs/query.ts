/** A query reads state without side effects. `TResult` is carried as a phantom type. */
export interface Query<TResult = unknown> {
  readonly type: string;
  /** Phantom result-type carrier; never present at runtime. */
  readonly __result?: TResult;
}

export type QueryResult<TQuery extends Query> =
  TQuery extends Query<infer TResult> ? TResult : never;

export interface QueryHandler<TQuery extends Query> {
  execute(query: TQuery): Promise<QueryResult<TQuery>>;
}
