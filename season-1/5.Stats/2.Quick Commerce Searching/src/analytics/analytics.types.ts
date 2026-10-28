import type { Script } from "../shared/text.js";

/** Where the shopper is. Sent by the browser (picked location) and copied onto every event. */
export interface EventLocation {
  city?: string;
  pincode?: string;
  storeId?: string;
}

interface BaseEvent extends EventLocation {
  /** ISO time. The fake traffic sends past times, so rollups use this, never "now". */
  ts: string;
  /** random id kept in the browser, no login */
  sessionId: string;
}

export interface SearchEvent extends BaseEvent {
  type: "search";
  q: string;
  qNorm: string;
  script: Script;
  results: number;
  latencyMs: number;
  /** first products shown, for impressions */
  shown: string[];
  /** shown products that matched only through the vector (no keyword hit): AI suggested tag candidates */
  vectorOnly: string[];
  /** 0 results in this store, but the catalog has matches: stock demand */
  outOfStock?: boolean;
}

export interface ClickEvent extends BaseEvent {
  type: "click" | "add";
  q: string;
  qNorm: string;
  productId: string;
  /** 1 = first result */
  position: number;
}

/** Someone searched from a place no dark store serves: demand for a new store */
export interface UnserviceableEvent extends BaseEvent {
  type: "unserviceable";
  q?: string;
  qNorm?: string;
}

export type AnalyticsEvent = SearchEvent | ClickEvent | UnserviceableEvent;
