import { z } from "zod";
import "../../../bootstrap/env.js"; // loads .env before process.env is read

const optional = (s: z.ZodType) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());

const schema = z.object({
  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),
  ANTHROPIC_VERSION: z.string().min(1).default("2023-06-01"),
});

const parsed = schema.parse(process.env);

export const anthropicConfig = {
  apiKey: parsed.ANTHROPIC_API_KEY as string | undefined,
  baseUrl: parsed.ANTHROPIC_BASE_URL.replace(/\/+$/, ""),
  version: parsed.ANTHROPIC_VERSION,
};

export const isAnthropicConfigured = (): boolean => Boolean(anthropicConfig.apiKey);
