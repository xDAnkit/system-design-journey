import { AiError, type LlmProvider, type ProviderJsonRequest, type ProviderJsonResult } from "../../ai.types.js";
import { postJson } from "../http.js";
import { anthropicConfig } from "./anthropic.config.js";
import type { AnthropicMessagesRequest, AnthropicMessagesResponse } from "./anthropic.types.js";

// Tool names must match ^[a-zA-Z0-9_-]{1,64}$
const toolName = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "result";

/**
 * Structured JSON through forced tool use: Claude must call the one tool, and the tool's
 * input_schema is our JSON Schema. Anthropic has no embeddings API, so this is LLM only.
 */
class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;

  async generateJson(req: ProviderJsonRequest): Promise<ProviderJsonResult> {
    if (!anthropicConfig.apiKey) throw new AiError("anthropic: ANTHROPIC_API_KEY is not set", "anthropic", false);
    const name = toolName(req.name);
    const body: AnthropicMessagesRequest = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: Math.min(1, req.temperature),
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      tools: [{ name, description: "Return the answer as structured data.", input_schema: req.jsonSchema }],
      tool_choice: { type: "tool", name },
    };
    const res = await postJson<AnthropicMessagesResponse>("anthropic", `${anthropicConfig.baseUrl}/v1/messages`, body, {
      headers: { "x-api-key": anthropicConfig.apiKey, "anthropic-version": anthropicConfig.version },
      signal: req.signal,
    });
    const call = res.content.find((c) => c.type === "tool_use" && c.name === name);
    return {
      data: call && call.type === "tool_use" ? call.input : null,
      tokensIn: res.usage?.input_tokens,
      tokensOut: res.usage?.output_tokens,
    };
  }
}

export const createAnthropicProvider = (): AnthropicProvider => new AnthropicProvider();
