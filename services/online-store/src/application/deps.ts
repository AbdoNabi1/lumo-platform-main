import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type {
  AccessRepository,
  MenuRepository,
  PolicyRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import type {
  EventRecorder,
  ImageRefsPort,
  LinkTargetsPort,
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
  readonly policies: PolicyRepository;
  readonly menus: MenuRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly imageRefs: ImageRefsPort;
  readonly passwordHasher: StorefrontPasswordHasher;
  readonly shopHost: ShopHostPort;
  readonly storeIdentity: StoreIdentityPort;
  readonly linkTargets: LinkTargetsPort;
  readonly events: EventRecorder;
}
