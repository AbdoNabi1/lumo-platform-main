/** A session's lifecycle state — open (activity may still be recorded) or closed. Closing is
 * terminal: a closed session is never reopened (Rules: "Sessions are append-only... No destructive
 * mutation"). `ResumeSession` always opens a *new* session linked by a `SessionTransition`, never
 * flips a closed session back to `"open"` — see `customer-session.ts`. */
export type SessionStatus = "open" | "closed";
