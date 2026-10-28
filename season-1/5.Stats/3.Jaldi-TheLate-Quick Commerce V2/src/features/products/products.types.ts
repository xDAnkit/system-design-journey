import type { Types } from "mongoose";
import type { TagSet, TagsSource } from "../../ai/tagging/tag.types.js";
import type { SizeUnit } from "../../catalog/size.js";

/** pending -> enriched (tags + vector) -> indexed (in Typesense). failed = enrich gave up after 3 tries. */
export type ProductStatus = "pending" | "enriched" | "indexed" | "failed";

/** What the admin (or the seed) sets. Everything else is made by the pipeline. */
export interface ProductFields {
  name: string;
  brand: string;
  category: string;
  size: string;
  sizeQty: number | null;
  sizeUnit: SizeUnit | null;
  price: number;
  mrp: number;
  icon: string;
  /** dark stores that have it in stock */
  storeIds: string[];
}

export interface Product extends ProductFields {
  _id: Types.ObjectId;
  /** catalog base item ("milk/milk") for seeded products, null for products the admin added */
  baseKey: string | null;
  tags: TagSet;
  tagsSource: TagsSource;
  /** normalized title the tags were made for; a new title means new tags */
  tagsFor: string;
  /** search queries the AI suggested and real clicks confirmed */
  suggestedTags: string[];
  /** id in the embeddings collection */
  embedKey: string | null;
  status: ProductStatus;
  error: string | null;
  popularity: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Kafka messages ----------

export type IngestMessage =
  | { op: "create"; id: string; product: ProductFields; tags?: TagSet; tagsFor?: string; at: string }
  | { op: "update"; id: string; changes: Partial<ProductFields>; tags?: TagSet; tagsFor?: string; at: string }
  | { op: "delete"; id: string; at: string };

export interface EnrichMessage {
  id: string;
}

export interface IndexMessage {
  id: string;
  delete?: boolean;
}

export interface EnrichDlqMessage {
  id: string;
  error: string;
  attempts: number;
  at: string;
}
