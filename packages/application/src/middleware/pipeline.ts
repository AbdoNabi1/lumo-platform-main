import type { Middleware, MiddlewareContext, NextFunction } from "./middleware";

/** Composes middlewares around a terminal handler, running them outside-in. */
export class Pipeline {
  private readonly middlewares: readonly Middleware[];

  constructor(middlewares: readonly Middleware[] = []) {
    this.middlewares = middlewares;
  }

  run<TResult>(context: MiddlewareContext, handler: () => Promise<TResult>): Promise<TResult> {
    const terminal: NextFunction = handler;
    const chain = this.middlewares.reduceRight<NextFunction>(
      (next, middleware) => () => middleware.handle(context, next),
      terminal,
    );
    // Sound by construction: the terminal handler produces `TResult`; middlewares pass it through.
    return chain() as Promise<TResult>;
  }
}
