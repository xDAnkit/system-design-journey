import type { EmbedProvider, EmbedProviderName, LlmProvider, LlmProviderName } from "./ai.types.js";
import { isAnthropicConfigured } from "./providers/anthropic/anthropic.config.js";
import { isGeminiConfigured } from "./providers/gemini/gemini.config.js";
import { isOllamaConfigured } from "./providers/ollama/ollama.config.js";
import { isOpenAiConfigured } from "./providers/openai/openai.config.js";

// Adding a provider = one folder under providers/ + one line in each map below.
const configured: Record<LlmProviderName, () => boolean> = {
  ollama: isOllamaConfigured,
  openai: isOpenAiConfigured,
  anthropic: isAnthropicConfigured,
  gemini: isGeminiConfigured,
};

// Lazy imports: only the provider that is actually used gets loaded.
const llmFactories: Record<LlmProviderName, () => Promise<LlmProvider>> = {
  ollama: () => import("./providers/ollama/ollama.provider.js").then((m) => m.createOllamaProvider()),
  openai: () => import("./providers/openai/openai.provider.js").then((m) => m.createOpenAiProvider()),
  anthropic: () => import("./providers/anthropic/anthropic.provider.js").then((m) => m.createAnthropicProvider()),
  gemini: () => import("./providers/gemini/gemini.provider.js").then((m) => m.createGeminiProvider()),
};

const embedFactories: Record<EmbedProviderName, () => Promise<EmbedProvider>> = {
  ollama: () => import("./providers/ollama/ollama.provider.js").then((m) => m.createOllamaProvider()),
  openai: () => import("./providers/openai/openai.provider.js").then((m) => m.createOpenAiProvider()),
  gemini: () => import("./providers/gemini/gemini.provider.js").then((m) => m.createGeminiProvider()),
};

const llmCache = new Map<LlmProviderName, Promise<LlmProvider>>();
const embedCache = new Map<EmbedProviderName, Promise<EmbedProvider>>();

export const isProviderConfigured = (name: LlmProviderName): boolean => configured[name]();

export const configuredProviders = (): LlmProviderName[] =>
  (Object.keys(configured) as LlmProviderName[]).filter((name) => configured[name]());

export const getLlmProvider = (name: LlmProviderName): Promise<LlmProvider> => {
  if (!llmCache.has(name)) llmCache.set(name, llmFactories[name]());
  return llmCache.get(name)!;
};

export const getEmbedProvider = (name: EmbedProviderName): Promise<EmbedProvider> => {
  if (!embedCache.has(name)) embedCache.set(name, embedFactories[name]());
  return embedCache.get(name)!;
};
