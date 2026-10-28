import { z } from "zod";
import "../../../bootstrap/env.js"; // loads .env before process.env is read

const optional = (s: z.ZodType) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());

const schema = z.object({
  OPENAI_API_KEY: optional(z.string().min(1)),
  // Any OpenAI-compatible server: Groq, OpenRouter, DeepSeek, Mistral, LM Studio, vLLM...
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
});

const parsed = schema.parse(process.env);

export const openAiConfig = {
  apiKey: parsed.OPENAI_API_KEY as string | undefined,
  baseUrl: parsed.OPENAI_BASE_URL.replace(/\/+$/, ""),
  // api.openai.com wants max_completion_tokens, most compatible servers still want max_tokens
  isOfficial: /api\.openai\.com/.test(parsed.OPENAI_BASE_URL),
};

// Local OpenAI-compatible servers (LM Studio, vLLM) often need no key
export const isOpenAiConfigured = (): boolean => Boolean(openAiConfig.apiKey) || !openAiConfig.isOfficial;
