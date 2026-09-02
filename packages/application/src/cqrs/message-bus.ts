import { Pipeline, type Middleware } from "../middleware";
import { DuplicateHandlerError, HandlerNotFoundError } from "./errors";

/** Internal type-erased dispatcher shared by the command and query buses (avoids duplication). */
export interface Message {
  readonly type: string;
}

export interface MessageHandler<TMessage extends Message, TResult> {
  execute(message: TMessage): Promise<TResult>;
}

export class MessageDispatcher {
  private readonly handlers = new Map<string, MessageHandler<Message, unknown>>();
  private readonly pipeline: Pipeline;

  constructor(middlewares: readonly Middleware[] = []) {
    this.pipeline = new Pipeline(middlewares);
  }

  register(type: string, handler: MessageHandler<Message, unknown>): void {
    if (this.handlers.has(type)) {
      throw new DuplicateHandlerError(type);
    }
    this.handlers.set(type, handler);
  }

  async dispatch<TResult>(message: Message): Promise<TResult> {
    const handler = this.handlers.get(message.type);
    if (handler === undefined) {
      throw new HandlerNotFoundError(message.type);
    }
    const result = await this.pipeline.run<unknown>(
      { messageType: message.type, metadata: {} },
      () => handler.execute(message),
    );
    // Sound by construction: the handler registered under `message.type` produces this result.
    return result as TResult;
  }
}
