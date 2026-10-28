/**
 * pnpm ai:check                                   checks the LLM and embedding model from .env
 * pnpm ai:check -- --llm=anthropic:claude-haiku-5-5   checks another LLM without touching .env
 *
 * Read-only: one small LLM call and one embedding call. No database, no Kafka.
 */
import { z } from "zod";
import { LLM_PROVIDERS, type LlmProviderName } from "./ai.types.js";
import { setLlmOverride } from "./ai.service.js";
import { ai } from "./index.js";

const cosine = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0);

const llmFlag = process.argv.find((a) => a.startsWith("--llm="))?.slice("--llm=".length);
if (llmFlag) {
  const [provider, ...model] = llmFlag.split(":");
  if (!LLM_PROVIDERS.includes(provider as LlmProviderName) || model.length === 0) {
    console.error(`--llm must look like provider:model, provider one of ${LLM_PROVIDERS.join(", ")}`);
    process.exit(1);
  }
  setLlmOverride({ provider: provider as LlmProviderName, model: model.join(":") });
}

const main = async (): Promise<void> => {
  const status = ai.status();
  console.log(`LLM        ${status.llm.provider} / ${status.llm.model}${status.fallback ? `  (fallback ${status.fallback.provider} / ${status.fallback.model})` : ""}`);
  console.log(`Embeddings ${status.embed.id}`);
  console.log(`Configured providers: ${status.configuredProviders.join(", ")}\n`);

  const llm = await ai.generateJson({
    name: "check",
    system: "You answer with JSON only.",
    prompt: 'Give the everyday word for "milk" in Hindi (Devanagari script) and in Tamil (Tamil script).',
    schema: z.object({ hindi: z.string(), tamil: z.string() }),
    maxTokens: 120,
  });
  console.log(`LLM ok in ${llm.ms.toFixed(0)} ms: ${JSON.stringify(llm.data)}`);

  const started = performance.now();
  const [milk, doodh, detergent] = await ai.embed(["milk", "दूध", "washing powder"], "query");
  const near = cosine(milk, doodh);
  const far = cosine(milk, detergent);
  console.log(`Embeddings ok in ${(performance.now() - started).toFixed(0)} ms: ${milk.length} dims | milk vs दूध ${near.toFixed(3)} | milk vs washing powder ${far.toFixed(3)}`);
  if (near <= far) {
    console.error("WARNING: milk is not closer to दूध than to washing powder. This embedding model will not handle Indian languages well.");
    process.exitCode = 1;
  }
};

main().catch((err: unknown) => {
  console.error(`ai:check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
