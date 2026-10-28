import { z } from "zod";
import "../bootstrap/env.js"; // loads .env before process.env is read
import { EMBED_PROVIDERS, LLM_PROVIDERS, type EmbedProviderName, type LlmProviderName } from "./ai.types.js";

const optional = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());

const schema = z.object({
  AI_LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("ollama"),
  AI_LLM_MODEL: optional(z.string().min(1)),
  // used when the main provider fails (down, out of credit, timeout)
  AI_LLM_FALLBACK: optional(z.enum(LLM_PROVIDERS)),
  AI_LLM_FALLBACK_MODEL: optional(z.string().min(1)),
  AI_EMBED_PROVIDER: z.enum(EMBED_PROVIDERS).default("ollama"),
  AI_EMBED_MODEL: optional(z.string().min(1)),
  // shorter vectors, only for models that support it (OpenAI text-embedding-3, Gemini)
  AI_EMBED_DIMS: optional(z.coerce.number().int().positive()),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

// Defaults only where a model was tested or is fixed by this project. OpenAI and Gemini need an explicit model.
const DEFAULT_LLM: Partial<Record<LlmProviderName, string>> = { ollama: "gemma3:4b", anthropic: "claude-haiku-5-5" };
const DEFAULT_EMBED: Partial<Record<EmbedProviderName, string>> = { ollama: "bge-m3" };

const fail = (message: string): never => {
  console.error(`Invalid AI configuration: ${message}`);
  process.exit(1);
};

const parsed = schema.safeParse(process.env);
if (!parsed.success) fail(JSON.stringify(z.flattenError(parsed.error).fieldErrors));
const data = parsed.data!;

const llmModel = data.AI_LLM_MODEL ?? DEFAULT_LLM[data.AI_LLM_PROVIDER] ?? fail(`set AI_LLM_MODEL for ${data.AI_LLM_PROVIDER}`);
const embedModel = data.AI_EMBED_MODEL ?? DEFAULT_EMBED[data.AI_EMBED_PROVIDER] ?? fail(`set AI_EMBED_MODEL for ${data.AI_EMBED_PROVIDER}`);
const fallback = data.AI_LLM_FALLBACK
  ? {
      provider: data.AI_LLM_FALLBACK,
      model: data.AI_LLM_FALLBACK_MODEL ?? DEFAULT_LLM[data.AI_LLM_FALLBACK] ?? fail(`set AI_LLM_FALLBACK_MODEL for ${data.AI_LLM_FALLBACK}`),
    }
  : null;

export interface LlmTarget {
  provider: LlmProviderName;
  model: string;
}

export const aiConfig = {
  llm: { provider: data.AI_LLM_PROVIDER, model: llmModel } as LlmTarget,
  fallback: fallback as LlmTarget | null,
  embed: { provider: data.AI_EMBED_PROVIDER, model: embedModel, dims: data.AI_EMBED_DIMS },
  timeoutMs: data.AI_TIMEOUT_MS,
};
