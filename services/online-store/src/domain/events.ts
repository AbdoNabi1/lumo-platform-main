import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Audit-trail events (spec 1.8). No consumer in this project; payloads carry no tenant and no secret. */
export class ThemePublished extends DomainEvent {
  readonly eventName = "online_store.theme.published";
  readonly data: { readonly releaseNumber: number };
  constructor(props: DomainEventProps, data: { readonly releaseNumber: number }) {
    super(props);
    this.data = data;
  }
}

export class AccessChanged extends DomainEvent {
  readonly eventName = "online_store.access.changed";
  readonly data: { readonly locked: boolean };
  constructor(props: DomainEventProps, data: { readonly locked: boolean }) {
    super(props);
    this.data = data;
  }
}

export class PreferencesUpdated extends DomainEvent {
  readonly eventName = "online_store.preferences.updated";
  readonly data: Record<string, never> = {};
  // DomainEvent's constructor is protected; a subclass must expose its own (preflight F9).
  constructor(props: DomainEventProps) {
    super(props);
  }
}

export const ONLINE_STORE_PUBLISHED_EVENTS: readonly string[] = [
  "online_store.theme.published",
  "online_store.access.changed",
  "online_store.preferences.updated",
];
