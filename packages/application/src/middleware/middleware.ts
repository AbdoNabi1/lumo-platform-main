/** Cross-cutting concern that wraps command/query execution (logging, validation, etc.). */

export interface MiddlewareContext {
  readonly messageType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type NextFunction = () => Promise<unknown>;

export interface Middleware {
  handle(context: MiddlewareContext, next: NextFunction): Promise<unknown>;
}
