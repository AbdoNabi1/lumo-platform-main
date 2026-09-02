import type { Middleware } from "../middleware";
import type { Command, CommandHandler, CommandResult } from "./command";
import { MessageDispatcher } from "./message-bus";

export interface CommandBus {
  register<TCommand extends Command>(
    type: TCommand["type"],
    handler: CommandHandler<TCommand>,
  ): void;
  execute<TCommand extends Command>(command: TCommand): Promise<CommandResult<TCommand>>;
}

export class InMemoryCommandBus implements CommandBus {
  private readonly dispatcher: MessageDispatcher;

  constructor(middlewares: readonly Middleware[] = []) {
    this.dispatcher = new MessageDispatcher(middlewares);
  }

  register<TCommand extends Command>(
    type: TCommand["type"],
    handler: CommandHandler<TCommand>,
  ): void {
    this.dispatcher.register(type, handler);
  }

  execute<TCommand extends Command>(command: TCommand): Promise<CommandResult<TCommand>> {
    return this.dispatcher.dispatch<CommandResult<TCommand>>(command);
  }
}
