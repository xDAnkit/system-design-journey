import { logger } from "../../bootstrap/logger.js";
import { Story } from "./stories.model.js";

const SWEEP_MS = 60_000;

// Expiry is a status change, never a delete: the row is kept for archive and highlights, and no
// Mongo TTL index is used. Reads already filter on expiresAt, so a late sweep only affects lists.
const sweep = async (): Promise<void> => {
  try {
    const result = await Story.updateMany(
      { status: "live", expiresAt: { $lte: new Date() } },
      { $set: { status: "expired" } },
    );
    if (result.modifiedCount > 0)
      logger.info(`Story sweeper expired ${result.modifiedCount} stories`);
  } catch (err) {
    logger.warn(
      `Story sweeper failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

export const startStoriesSweeper = (): void => {
  void sweep();
  setInterval(() => void sweep(), SWEEP_MS).unref();
};
