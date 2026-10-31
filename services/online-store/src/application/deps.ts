import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type {
  AccessRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import type {
  EventRecorder,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "./ports";

export interface OnlineStoreDeps {
  readonly preferences: PreferencesRepository;
  readonly access: AccessRepository;
  readonly themes: ThemeRepository;
  readonly releases: ThemeReleaseRepository;
  readonly previewTokens: PreviewTokenRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly imageRefs: ImageRefsPort;
  readonly passwordHasher: StorefrontPasswordHasher;
  readonly shopHost: ShopHostPort;
  readonly storeIdentity: StoreIdentityPort;
  readonly events: EventRecorder;
}
