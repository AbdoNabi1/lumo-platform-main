import type { Middleware } from "../middleware";
import type { Query, QueryHandler, QueryResult } from "./query";
import { MessageDispatcher } from "./message-bus";

export interface QueryBus {
  register<TQuery extends Query>(type: TQuery["type"], handler: QueryHandler<TQuery>): void;
  execute<TQuery extends Query>(query: TQuery): Promise<QueryResult<TQuery>>;
}

export class InMemoryQueryBus implements QueryBus {
  private readonly dispatcher: MessageDispatcher;

  constructor(middlewares: readonly Middleware[] = []) {
    this.dispatcher = new MessageDispatcher(middlewares);
  }

  register<TQuery extends Query>(type: TQuery["type"], handler: QueryHandler<TQuery>): void {
    this.dispatcher.register(type, handler);
  }

  execute<TQuery extends Query>(query: TQuery): Promise<QueryResult<TQuery>> {
    return this.dispatcher.dispatch<QueryResult<TQuery>>(query);
  }
}
