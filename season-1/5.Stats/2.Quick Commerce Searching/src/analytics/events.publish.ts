import type { FastifyRequest } from "fastify";
import { TOPICS, sendEvent } from "../bootstrap/kafka.js";
import { logger } from "../bootstrap/logger.js";
import { PINCODES, STORES, resolveLocation } from "../locations/locations.service.js";
import type { AnalyticsEvent, EventLocation } from "./analytics.types.js";

/** Fire and forget: a search never waits for Kafka, and a Kafka outage loses events, not searches. */
export const publishEvent = (event: AnalyticsEvent): void => {
  void sendEvent(TOPICS.searchEvents, event.sessionId, event).catch((err: unknown) => logger.debug(`event dropped: ${err instanceof Error ? err.message : String(err)}`));
};

const SESSION = /^[A-Za-z0-9-]{8,64}$/;

/** Browser-made random id (localStorage). Anything else counts as one anonymous visitor. */
export const sessionOf = (req: FastifyRequest, fromQuery?: string): string => {
  const header = req.headers["x-session-id"];
  const id = typeof header === "string" ? header : fromQuery;
  return id && SESSION.test(id) ? id : "anonymous";
};

/** Location from the client, checked against our own data: unknown pincodes and stores are dropped. */
export const eventLocation = (input: { pincode?: string; storeId?: string }): EventLocation & { serviceable: boolean | null } => {
  if (input.pincode && PINCODES.has(input.pincode)) {
    const loc = resolveLocation({ pincode: input.pincode })!;
    return { city: loc.city, pincode: loc.pincode, storeId: loc.store?.id, serviceable: loc.serviceable };
  }
  const store = input.storeId ? STORES.get(input.storeId) : undefined;
  if (store) return { city: store.city, storeId: store.id, serviceable: true };
  return { serviceable: null };
};
