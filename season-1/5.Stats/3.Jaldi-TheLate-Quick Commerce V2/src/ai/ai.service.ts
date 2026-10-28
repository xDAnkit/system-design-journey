import { logger } from "../bootstrap/logger.js";
import { aiConfig, type LlmTarget } from "./ai.config.js";
import { configuredProviders, getEmbedProvider, getLlmProvider, isProviderConfigured } from "./ai.registry.js";
import { toJsonSchema } from "./ai.schema.js";
import { AiError, type EmbedKind, type GenerateJsonRequest, type GenerateJsonResult } from "./ai.types.js";

const MAX_ATTEMPTS = 3;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number): number => 300 * 2 ** (attempt - 1);
const isRetryable = (err: unknown): boolean => err instanceof AiError && err.retryable;

// Settings page override (stored in Redis, see ai.settings.ts). null = use the env config.
let override: LlmTarget | null = null;
export const setLlmOverride = (target: LlmTarget | null): void => {
  override = target;
};
export const currentLlm = (): LlmTarget => override ?? aiConfig.llm;

async function runLlm<T>(target: LlmTarget, req: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> {
  if (!isProviderConfigured(target.provider)) throw new AiError(`${target.provider}: not configured (API key missing)`, target.provider, false);
  const provider = await getLlmProvider(target.provider);
  const jsonSchema = toJsonSchema(req.schema);
  const name = req.name ?? "result";
  const started = performance.now();
  let problem = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const out = await provider.generateJson({
        model: target.model,
        system: req.system,
        prompt: req.prompt,
        jsonSchema,
        name,
        maxTokens: req.maxTokens ?? 800,
        // a retry after a malformed answer gets a little randomness, the same input would give the same output
        temperature: attempt === 1 ? (req.temperature ?? 0) : 0.3,
        signal: AbortSignal.timeout(aiConfig.timeoutMs),
      });
      const parsed = req.schema.safeParse(out.data);
      if (parsed.success) {
        const ms = performance.now() - started;
        logger.debug(`AI ${target.provider}/${target.model} ${name}: ${ms.toFixed(0)} ms, tokens in ${out.tokensIn ?? "?"} out ${out.tokensOut ?? "?"}`);
        return { data: parsed.data, provider: target.provider, model: target.model, ms, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
      }
      problem = out.data == null ? "reply was not JSON" : `reply did not match the schema (${parsed.error.issues[0]?.message ?? "unknown"})`;
    } catch (err) {
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) throw err;
      problem = err instanceof Error ? err.message : String(err);
      await sleep(backoff(attempt));
    }
  }
  throw new AiError(`${target.provider}: ${problem} after ${MAX_ATTEMPTS} tries`, target.provider, false);
}

/** JSON from the configured LLM, validated with the zod schema. Falls back to AI_LLM_FALLBACK if set. */
export async function generateJson<T>(req: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> {
  const primary = currentLlm();
  try {
    return await runLlm(primary, req);
  } catch (err) {
    const fallback = aiConfig.fallback;
    if (!fallback || (fallback.provider === primary.provider && fallback.model === primary.model)) throw err;
    logger.warn(`AI ${primary.provider} failed (${err instanceof Error ? err.message : String(err)}), using fallback ${fallback.provider}/${fallback.model}`);
    return runLlm(fallback, req);
  }
}

const unit = (v: number[]): number[] => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
};

/** Unit-length vectors from the configured embedding model, split into provider-sized batches. */
export async function embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { provider: name, model, dims } = aiConfig.embed;
  const provider = await getEmbedProvider(name);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += provider.maxBatch) {
    const chunk = texts.slice(i, i + provider.maxBatch);
    for (let attempt = 1; ; attempt++) {
      try {
        const vectors = await provider.embed({ model, texts: chunk, kind, dims, signal: AbortSignal.timeout(aiConfig.timeoutMs) });
        if (vectors.length !== chunk.length) throw new AiError(`${name}: got ${vectors.length} vectors for ${chunk.length} texts`, name, false);
        out.push(...vectors.map(unit));
        break;
      } catch (err) {
        if (!isRetryable(err) || attempt >= MAX_ATTEMPTS) throw err;
        await sleep(backoff(attempt));
      }
    }
  }
  return out;
}

/** Stable id of the embedding setup, stored next to every vector ("ollama:bge-m3"). */
export const embedModelId = (): string => {
  const { provider, model, dims } = aiConfig.embed;
  return `${provider}:${model}${dims ? `@${dims}` : ""}`;
};

let dimsPromise: Promise<number> | null = null;
/** Vector length of the embedding model, found once by embedding a probe text. */
export const embedDims = (): Promise<number> => {
  dimsPromise ??= embed(["dimension probe"], "document")
    .then(([v]) => v.length)
    .catch((err: unknown) => {
      dimsPromise = null; // try again next time, the model may be loading
      throw err;
    });
  return dimsPromise;
};

export const aiStatus = () => ({
  llm: currentLlm(),
  envLlm: aiConfig.llm,
  overridden: override !== null,
  fallback: aiConfig.fallback,
  embed: { ...aiConfig.embed, id: embedModelId() },
  configuredProviders: configuredProviders(),
});
