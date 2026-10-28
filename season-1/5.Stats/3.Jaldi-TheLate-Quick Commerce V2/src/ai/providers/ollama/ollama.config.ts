import { z } from "zod";
import "../../../bootstrap/env.js"; // loads .env before process.env is read

const schema = z.object({
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  // keep the model in memory between calls, a cold load costs ~2 s (bge-m3) to ~7 s (gemma3:4b)
  OLLAMA_KEEP_ALIVE: z.string().min(1).default("24h"),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(2048),
});

const parsed = schema.parse(process.env);

export const ollamaConfig = {
  url: parsed.OLLAMA_URL.replace(/\/+$/, ""),
  keepAlive: parsed.OLLAMA_KEEP_ALIVE,
  numCtx: parsed.OLLAMA_NUM_CTX,
};

// Local server, no key needed
export const isOllamaConfigured = (): boolean => true;
