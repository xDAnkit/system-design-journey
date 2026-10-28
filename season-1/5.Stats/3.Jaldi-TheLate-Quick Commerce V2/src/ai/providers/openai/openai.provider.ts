import { parseJsonLoose } from "../../ai.schema.js";
import { AiError, type EmbedProvider, type LlmProvider, type ProviderEmbedRequest, type ProviderJsonRequest, type ProviderJsonResult } from "../../ai.types.js";
import { postJson } from "../http.js";
import { openAiConfig } from "./openai.config.js";
import type { OpenAiChatRequest, OpenAiChatResponse, OpenAiEmbedRequest, OpenAiEmbedResponse } from "./openai.types.js";

const headers = (): Record<string, string> => (openAiConfig.apiKey ? { authorization: `Bearer ${openAiConfig.apiKey}` } : {});

class OpenAiProvider implements LlmProvider, EmbedProvider {
  readonly name = "openai" as const;
  readonly maxBatch = 256;

  async generateJson(req: ProviderJsonRequest): Promise<ProviderJsonResult> {
    const body: OpenAiChatRequest = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      // strict needs every property required and additionalProperties:false everywhere, not every schema has that
      response_format: { type: "json_schema", json_schema: { name: req.name, schema: req.jsonSchema, strict: false } },
      temperature: req.temperature,
      ...(openAiConfig.isOfficial ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
    };
    const url = `${openAiConfig.baseUrl}/chat/completions`;
    let res: OpenAiChatResponse;
    try {
      res = await postJson<OpenAiChatResponse>("openai", url, body, { headers: headers(), signal: req.signal });
    } catch (err) {
      // reasoning models only accept the default temperature: retry once without it
      if (err instanceof AiError && err.status === 400 && /temperature/i.test(err.message)) {
        delete body.temperature;
        res = await postJson<OpenAiChatResponse>("openai", url, body, { headers: headers(), signal: req.signal });
      } else {
        throw err;
      }
    }
    const message = res.choices?.[0]?.message;
    if (message?.refusal) throw new AiError(`openai: refused (${message.refusal.slice(0, 120)})`, "openai", false);
    return { data: parseJsonLoose(message?.content ?? ""), tokensIn: res.usage?.prompt_tokens, tokensOut: res.usage?.completion_tokens };
  }

  async embed(req: ProviderEmbedRequest): Promise<number[][]> {
    const body: OpenAiEmbedRequest = { model: req.model, input: req.texts, ...(req.dims ? { dimensions: req.dims } : {}) };
    const res = await postJson<OpenAiEmbedResponse>("openai", `${openAiConfig.baseUrl}/embeddings`, body, { headers: headers(), signal: req.signal });
    return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export const createOpenAiProvider = (): OpenAiProvider => new OpenAiProvider();
