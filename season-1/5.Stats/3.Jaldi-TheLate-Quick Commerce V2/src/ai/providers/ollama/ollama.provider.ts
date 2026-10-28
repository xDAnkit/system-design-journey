import { parseJsonLoose } from "../../ai.schema.js";
import type { EmbedKind, EmbedProvider, LlmProvider, ProviderEmbedRequest, ProviderJsonRequest, ProviderJsonResult } from "../../ai.types.js";
import { postJson } from "../http.js";
import { ollamaConfig } from "./ollama.config.js";
import type { OllamaEmbedRequest, OllamaEmbedResponse, OllamaGenerateRequest, OllamaGenerateResponse } from "./ollama.types.js";

// Models that think by default. Thinking costs ~40 s per call, so they run with think:false.
// /api/generate, not /api/chat: on Ollama 0.31 /api/chat drops `format` once thinking is off (tested with qwen3.5).
const THINKING_MODELS = /^(qwen3|qwen3\.5|deepseek-r1|gpt-oss|magistral|phi4-reasoning)/i;

// Prefixes some embedding models were trained with. bge-m3 needs none.
const withPrefix = (model: string, kind: EmbedKind, text: string): string => {
  if (/e5/i.test(model)) return `${kind === "query" ? "query" : "passage"}: ${text}`;
  if (/nomic-embed/i.test(model)) return `${kind === "query" ? "search_query" : "search_document"}: ${text}`;
  return text;
};

class OllamaProvider implements LlmProvider, EmbedProvider {
  readonly name = "ollama" as const;
  readonly maxBatch = 32;

  async generateJson(req: ProviderJsonRequest): Promise<ProviderJsonResult> {
    const body: OllamaGenerateRequest = {
      model: req.model,
      system: req.system,
      prompt: req.prompt,
      format: req.jsonSchema,
      stream: false,
      keep_alive: ollamaConfig.keepAlive,
      options: { temperature: req.temperature, seed: 7, num_ctx: ollamaConfig.numCtx, num_predict: req.maxTokens },
      ...(THINKING_MODELS.test(req.model) ? { think: false as const } : {}),
    };
    const res = await postJson<OllamaGenerateResponse>("ollama", `${ollamaConfig.url}/api/generate`, body, { signal: req.signal });
    return { data: parseJsonLoose(res.response ?? ""), tokensIn: res.prompt_eval_count, tokensOut: res.eval_count };
  }

  async embed(req: ProviderEmbedRequest): Promise<number[][]> {
    const body: OllamaEmbedRequest = {
      model: req.model,
      input: req.texts.map((t) => withPrefix(req.model, req.kind, t)),
      keep_alive: ollamaConfig.keepAlive,
    };
    const res = await postJson<OllamaEmbedResponse>("ollama", `${ollamaConfig.url}/api/embed`, body, { signal: req.signal });
    return res.embeddings;
  }
}

export const createOllamaProvider = (): OllamaProvider => new OllamaProvider();
