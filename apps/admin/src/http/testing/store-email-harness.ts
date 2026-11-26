import type { Clock } from "@platform/contracts";
import {
  InMemoryEmailConnectionVault,
  InMemoryStoreEmailProvider,
  type StoreEmailMessage,
} from "@platform/notifications";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { staffIdentifier } from "../../interfaces/staff-auth.admin-controller";

/** A store's own (fake) Resend key, as typed into Settings > Notifications. */
export const STORE_API_KEY = "re_store_AbCdEfGhIjKlMnOpQrStUv1234";

export interface PlatformMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface StoreEmailHarness {
  /** Spread into `createAdminHttpApi` / `wireAdmin`. */
  readonly deps: {
    readonly emailVault: InMemoryEmailConnectionVault;
    readonly emailProvider: InMemoryStoreEmailProvider;
    readonly emailSender: { send: (message: PlatformMail) => Promise<void> };
    readonly passwordAuthProvider: HashedPasswordAuthProvider;
  };
  /** The merchant's provider: every mail that went through a STORE's own account. */
  readonly provider: InMemoryStoreEmailProvider;
  /** Everything the store's provider was asked to send (live). */
  readonly storeMail: StoreEmailMessage[];
  /** Everything the PLATFORM's own sender was asked to send (must stay empty for customer mail). */
  readonly platformMail: PlatformMail[];
}

/**
 * TEST HARNESS: a platform `EmailSender` SPY (Morbeh's own account) next to a recording merchant
 * provider and an in-memory vault, plus a staff credential so the acting staff member has an email of
 * their own (the address a connection test mail goes to). A customer mail that reached the platform
 * sender shows up in `platformMail`.
 */
export async function storeEmailHarness(options: {
  readonly tenantId: string;
  readonly staffId: string;
  readonly staffEmail: string;
  readonly clock: Clock;
}): Promise<StoreEmailHarness> {
  const provider = new InMemoryStoreEmailProvider();
  const storeMail: StoreEmailMessage[] = [];
  const originalSend = provider.send.bind(provider);
  provider.send = (credentials, message) => {
    storeMail.push(message);
    return originalSend(credentials, message);
  };
  const platformMail: PlatformMail[] = [];
  const store = new InMemoryPasswordCredentialStore();
  await store.save({
    tenantId: options.tenantId,
    identifier: staffIdentifier(options.staffEmail),
    principalExternalId: options.staffId,
    passwordHash: "not-a-real-hash",
  });
  return {
    deps: {
      emailVault: new InMemoryEmailConnectionVault(),
      emailProvider: provider,
      emailSender: {
        send: (message) => {
          platformMail.push(message);
          return Promise.resolve();
        },
      },
      passwordAuthProvider: new HashedPasswordAuthProvider({
        store,
        hasher: new ScryptPasswordHasher({ log2N: 10 }),
        clock: options.clock,
      }),
    },
    provider,
    storeMail,
    platformMail,
  };
}
