import { z } from "zod";
import { logger } from "../bootstrap/logger.js";
import { redisClient } from "../bootstrap/redis.js";
import { isProviderConfigured } from "./ai.registry.js";
import { setLlmOverride } from "./ai.service.js";
import { LLM_PROVIDERS } from "./ai.types.js";

// Settings page "button": the chosen LLM lives in Redis, so the API and every worker switch without a restart.
const KEY = "ai:settings";
const SYNC_MS = 10_000;

export const aiSettingsSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().trim().min(1).max(100),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export async function readAiSettings(): Promise<AiSettings | null> {
  if (!redisClient.isReady) return null;
  const raw = await redisClient.get(KEY);
  if (!raw) return null;
  try {
    const parsed = aiSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** null = back to the env config. */
export async function saveAiSettings(settings: AiSettings | null): Promise<void> {
  if (settings) await redisClient.set(KEY, JSON.stringify(settings));
  else await redisClient.del(KEY);
  setLlmOverride(settings);
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAiSettingsSync(): void {
  const tick = async (): Promise<void> => {
    try {
      const settings = await readAiSettings();
      // an override for a provider without a key would fail every call, ignore it
      setLlmOverride(settings && isProviderConfigured(settings.provider) ? settings : null);
    } catch (err) {
      logger.debug(`AI settings sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  void tick();
  if (timer) return;
  timer = setInterval(() => void tick(), SYNC_MS);
  timer.unref();
}
