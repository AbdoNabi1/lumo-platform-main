import { logger, toSerializableError } from "@platform/utils";

export type ErrorContext = Record<string, unknown>;

/** Reports unexpected errors to an observability backend (Sentry-backed reporter plugs in later). */
export interface ErrorReporter {
  report(error: unknown, context?: ErrorContext): void;
}

/** Default reporter: emits a structured error log via the platform logger. */
export class LoggingErrorReporter implements ErrorReporter {
  report(error: unknown, context: ErrorContext = {}): void {
    const serialized = toSerializableError(error);
    logger.error(serialized.message, { ...context, name: serialized.name, code: serialized.code });
  }
}
