import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { AddAddress } from "./application/add-address.use-case";
import { ChangeConsent } from "./application/change-consent.use-case";
import { GetCustomer } from "./application/get-customer.use-case";
import { ListCustomers } from "./application/list-customers.use-case";
import { AddMembership, ChangeMembershipRole } from "./application/membership.use-cases";
import { ArchiveOrganization, CreateOrganization } from "./application/organization.use-cases";
import { RegisterCustomer } from "./application/register-customer.use-case";
import { ResolveGuestCustomer } from "./application/resolve-guest-customer.use-case";
import { CreateUser, DeactivateUser, RenameUser } from "./application/user.use-cases";
import type {
  MembershipRepository,
  OrganizationRepository,
  UserRepository,
} from "./domain/access-repositories";
import type { CustomerRepository } from "./domain/customer-repository";
import { IdentityEventTranslator } from "./infrastructure/identity-event-translator";
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  InMemoryUserRepository,
} from "./infrastructure/in-memory-access-repositories";
import { InMemoryCustomerRepository } from "./infrastructure/in-memory-customer-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaMembershipRepository,
  PrismaOrganizationRepository,
  PrismaUserRepository,
} from "./infrastructure/prisma-access-repositories";
import { PrismaCustomerRepository } from "./infrastructure/prisma-customer-repository";
import { AccessController } from "./interfaces/access.controller";
import { CustomerController } from "./interfaces/customer.controller";

export interface IdentityWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaCustomerRepository` (ADR-0014, WP-10
   * T10.3: per-call `tenantId`, no `deps.tenantId` — same shape as `PrismaUserRepository`/
   * `PrismaOrganizationRepository`/`PrismaMembershipRepository`) + `PrismaUnitOfWork`; absent ⇒
   * in-memory, unchanged. No repository built here is tenant-pinned any more, so `wireIdentity`
   * itself takes no `tenantId` (a caller's `deps` object may still carry one for an unrelated
   * wireX call sharing the same literal — an unused excess field, not consumed here).
   */
  readonly prisma?: Database;
}

export interface WiredIdentity {
  readonly customers: CustomerController;
  /** Users/Organizations/Memberships (Sprint 4.1, Option A) — additive to the Customer vertical. */
  readonly access: AccessController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface IdentityRepos {
  readonly customers: CustomerRepository;
  readonly users: UserRepository;
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
}

/** Builds both controllers from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildControllers(
  repos: IdentityRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: IdentityWiringDeps,
): { customers: CustomerController; access: AccessController } {
  const { customers, users, organizations, memberships } = repos;

  const controller = new CustomerController({
    registerCustomer: new RegisterCustomer({
      customers,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    resolveGuestCustomer: new ResolveGuestCustomer({
      customers,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    addAddress: new AddAddress({ customers, unitOfWork, idGenerator: deps.idGenerator }),
    changeConsent: new ChangeConsent({
      customers,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    getCustomer: new GetCustomer({ customers }),
    listCustomers: new ListCustomers({ customers }),
  });

  const access = new AccessController({
    createUser: new CreateUser({
      users,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    renameUser: new RenameUser({
      users,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    deactivateUser: new DeactivateUser({
      users,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    createOrganization: new CreateOrganization({
      organizations,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    archiveOrganization: new ArchiveOrganization({
      organizations,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    addMembership: new AddMembership({
      memberships,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    changeMembershipRole: new ChangeMembershipRole({
      memberships,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
  });

  return { customers: controller, access };
}

/**
 * Composition root for the Identity context. Prisma slice (all 4 repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireIdentity(deps: IdentityWiringDeps): WiredIdentity {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new IdentityEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "identity",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time any more (see IdentityWiringDeps'
    // doc comment) — every repository built below takes tenantId per call instead.
    const context = rootEventContext(deps.idGenerator);
    const accessDeps = { prisma: deps.prisma, outbox, context };
    const repos: IdentityRepos = {
      customers: new PrismaCustomerRepository({ prisma: deps.prisma, outbox, context }),
      users: new PrismaUserRepository(accessDeps),
      organizations: new PrismaOrganizationRepository(accessDeps),
      memberships: new PrismaMembershipRepository(accessDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const controllers = buildControllers(repos, unitOfWork, deps);

    return { ...controllers, drainOutbox: async () => 0, deliveredEventTypes: [] };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new IdentityEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "identity",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: IdentityRepos = {
    customers: new InMemoryCustomerRepository({ outbox: outboxWriter, context }),
    users: new InMemoryUserRepository({ outbox: outboxWriter, context }),
    organizations: new InMemoryOrganizationRepository({ outbox: outboxWriter, context }),
    memberships: new InMemoryMembershipRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controllers = buildControllers(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  bus.subscribe("identity.customer.registered.v1", sink);
  bus.subscribe("identity.customer.consent_changed.v1", sink);
  bus.subscribe("identity.user.created.v1", sink);
  bus.subscribe("identity.user.updated.v1", sink);
  bus.subscribe("identity.user.deactivated.v1", sink);
  bus.subscribe("identity.organization.created.v1", sink);
  bus.subscribe("identity.membership.created.v1", sink);
  bus.subscribe("identity.membership.role_changed.v1", sink);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    ...controllers,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
