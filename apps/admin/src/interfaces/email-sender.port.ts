/** Plan 1C: the one way the platform sends email. Implementations never log the body. */
export interface EmailSender {
  send(message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
  }): Promise<void>;
}
