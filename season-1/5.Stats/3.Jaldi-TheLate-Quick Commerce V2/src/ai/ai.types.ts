import type { z } from "zod";

export const LLM_PROVIDERS = ["ollama", "openai", "anthropic", "gemini"] as const;
// Anthropic has no embeddings API, so it is LLM only
export const EMBED_PROVIDERS = ["ollama", "openai", "gemini"] as const;

export type LlmProviderName = (typeof LLM_PROVIDERS)[number];
export type EmbedProviderName = (typeof EMBED_PROVIDERS)[number];

/** Some embedding models are trained with a different prefix for queries and documents. */
export type EmbedKind = "query" | "document";

/** What app code asks for: JSON that matches `schema`. Which provider answers is decided by config. */
export interface GenerateJsonRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Short name of the JSON shape. Used as the tool / schema name by providers that need one. */
  name?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateJsonResult<T> {
  data: T;
  provider: LlmProviderName;
  model: string;
  ms: number;
  tokensIn?: number;
  tokensOut?: number;
}

/** What a provider receives: the zod schema is already a JSON Schema. */
export interface ProviderJsonRequest {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  name: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface ProviderJsonResult {
  /** Parsed JSON, not validated yet. The service validates it with the zod schema. */
  data: unknown;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ProviderEmbedRequest {
  model: string;
  texts: string[];
  kind: EmbedKind;
  /** Optional output size, for models that support shorter vectors (OpenAI, Gemini). */
  dims?: number;
  signal: AbortSignal;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  generateJson(req: ProviderJsonRequest): Promise<ProviderJsonResult>;
}

export interface EmbedProvider {
  readonly name: EmbedProviderName;
  /** Most texts one call may carry. The service splits bigger lists. */
  readonly maxBatch: number;
  embed(req: ProviderEmbedRequest): Promise<number[][]>;
}

/** Every provider error. `retryable` = network error, timeout, 429 or 5xx. */
export class AiError extends Error {
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, provider: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "AiError";
    this.provider = provider;
    this.retryable = retryable;
    this.status = status;
  }
}
