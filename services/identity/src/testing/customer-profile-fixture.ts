import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { Customer } from "../domain/customer";
import type { CustomerAnnotationRepository } from "../domain/customer-annotations";
import type { CustomerRepository } from "../domain/customer-repository";
import { Email } from "../domain/value-objects/email";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryCustomerAnnotationRepository } from "../infrastructure/in-memory-customer-annotation-repository";
import { InMemoryCustomerRepository } from "../infrastructure/in-memory-customer-repository";

export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";

/** A unit of work that hands every `run` a fresh, identifiable transaction token and records them. */
export class RecordingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  readonly transactions: { readonly id: number }[] = [];
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    const tx = { id: this.transactions.length + 1 };
    this.transactions.push(tx);
    return work(tx);
  }
}

/** Real in-memory repositories, with call recording on top (the calls still reach the real store). */
export function buildCustomerFixture() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const clock: Clock = { now: () => new Date("2026-11-24T00:00:00.000Z") };
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "identity",
  });
  const realCustomers = new InMemoryCustomerRepository({
    outbox,
    context: rootEventContext(idGenerator),
  });
  const saves: { tx: unknown; customerId: string }[] = [];
  const customers: CustomerRepository = {
    save: async (customer, tenantId, tx) => {
      saves.push({ tx, customerId: customer.id.toString() });
      await realCustomers.save(customer, tenantId, tx);
    },
    findById: (id, tenantId) => realCustomers.findById(id, tenantId),
    findByEmail: (email, tenantId) => realCustomers.findByEmail(email, tenantId),
    list: (query, tenantId) => realCustomers.list(query, tenantId),
  };
  const realAnnotations = new InMemoryCustomerAnnotationRepository({ customers: realCustomers });
  const annotationCalls: { method: string; tx: unknown }[] = [];
  const annotations: CustomerAnnotationRepository = {
    annotationsOf: (ids, tenantId, tx) => {
      annotationCalls.push({ method: "annotationsOf", tx });
      return realAnnotations.annotationsOf(ids, tenantId, tx);
    },
    setNote: (id, note, tenantId, tx) => {
      annotationCalls.push({ method: "setNote", tx });
      return realAnnotations.setNote(id, note, tenantId, tx);
    },
    replaceTags: (id, tags, tenantId, tx) => {
      annotationCalls.push({ method: "replaceTags", tx });
      return realAnnotations.replaceTags(id, tags, tenantId, tx);
    },
  };
  const unitOfWork = new RecordingUnitOfWork();

  async function seedCustomer(email = "seed@example.com", tenantId = TENANT_A): Promise<Customer> {
    const parsed = Email.create(email);
    if (!parsed.ok) throw new Error("fixture email");
    const customer = Customer.register(
      UniqueEntityId.from(idGenerator.generate()),
      parsed.value,
      "Seed",
      idGenerator.generate(),
      clock.now(),
    );
    await realCustomers.save(customer, tenantId);
    return customer;
  }

  function outboxTypes(): string[] {
    return outboxStore.snapshot().map((entry) => entry.topic);
  }
  function outboxText(): string[] {
    const decoder = new TextDecoder();
    return outboxStore.snapshot().map((entry) => decoder.decode(entry.payload));
  }

  return {
    idGenerator,
    clock,
    customers,
    annotations,
    unitOfWork,
    saves,
    annotationCalls,
    outboxStore,
    outboxTypes,
    outboxText,
    seedCustomer,
  };
}
