/** A command expresses intent to change state. `TResult` is carried as a phantom type. */
export interface Command<TResult = unknown> {
  readonly type: string;
  /** Phantom result-type carrier; never present at runtime. */
  readonly __result?: TResult;
}

export type CommandResult<TCommand extends Command> =
  TCommand extends Command<infer TResult> ? TResult : never;

export interface CommandHandler<TCommand extends Command> {
  execute(command: TCommand): Promise<CommandResult<TCommand>>;
}
