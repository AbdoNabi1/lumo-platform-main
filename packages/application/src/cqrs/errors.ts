import { AppError } from "@platform/utils";

export class HandlerNotFoundError extends AppError {
  constructor(messageType: string) {
    super(`No handler registered for message type: ${messageType}`, { code: "HANDLER_NOT_FOUND" });
  }
}

export class DuplicateHandlerError extends AppError {
  constructor(messageType: string) {
    super(`A handler is already registered for message type: ${messageType}`, {
      code: "DUPLICATE_HANDLER",
    });
  }
}
