/** Plan 1B-1: one-way password hashing. Implementations never return or log the password. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False — never a throw — for a wrong password or a malformed stored value. */
  verify(password: string, stored: string): Promise<boolean>;
  /** True when `stored` was made with parameters other than this hasher's current ones. */
  needsRehash(stored: string): boolean;
}
