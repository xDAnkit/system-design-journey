// The only thing app code imports from the AI module. Which provider answers is config, not code.
import { aiStatus, currentLlm, embed, embedDims, embedModelId, generateJson } from "./ai.service.js";

export const ai = { generateJson, embed, embedDims, embedModelId, currentLlm, status: aiStatus };

export type { EmbedKind, GenerateJsonRequest, GenerateJsonResult, LlmProviderName, EmbedProviderName } from "./ai.types.js";
export { AiError, LLM_PROVIDERS, EMBED_PROVIDERS } from "./ai.types.js";
export { isProviderConfigured, configuredProviders } from "./ai.registry.js";
