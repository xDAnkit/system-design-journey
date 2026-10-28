import { SearchEventModel, StatsDailyModel, TagSuggestionModel } from "../analytics/analytics.models.js";
import { ProductModel } from "../features/products/products.model.js";
import { EmbeddingModel } from "../search/embeddings.js";
import { logger } from "./logger.js";

const NAMESPACE_EXISTS = 48;

// bufferCommands is off, so Mongoose's auto-index at model load runs before the connection is ready and
// builds nothing. Build indexes here instead. createIndexes only adds missing ones, it never drops.
export async function ensureIndexes(): Promise<void> {
  try {
    // a time-series collection must be created with its options before the first insert
    await SearchEventModel.createCollection().catch((err: { code?: number }) => {
      if (err.code !== NAMESPACE_EXISTS) throw err;
    });
    await Promise.all([ProductModel, EmbeddingModel, SearchEventModel, StatsDailyModel, TagSuggestionModel].map((m) => m.createIndexes()));
  } catch (err) {
    logger.error(`Index build failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
