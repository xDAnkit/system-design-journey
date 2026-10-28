import { parseJsonLoose, toGeminiSchema } from "../../ai.schema.js";
import { AiError, type EmbedProvider, type LlmProvider, type ProviderEmbedRequest, type ProviderJsonRequest, type ProviderJsonResult } from "../../ai.types.js";
import { postJson } from "../http.js";
import { geminiConfig } from "./gemini.config.js";
import type { GeminiBatchEmbedRequest, GeminiBatchEmbedResponse, GeminiGenerateRequest, GeminiGenerateResponse } from "./gemini.types.js";

// The key goes in a header, never in the URL, so it can't end up in a log line
const headers = (): Record<string, string> => {
  if (!geminiConfig.apiKey) throw new AiError("gemini: GEMINI_API_KEY is not set", "gemini", false);
  return { "x-goog-api-key": geminiConfig.apiKey };
};

class GeminiProvider implements LlmProvider, EmbedProvider {
  readonly name = "gemini" as const;
  readonly maxBatch = 100;

  async generateJson(req: ProviderJsonRequest): Promise<ProviderJsonResult> {
    const body: GeminiGenerateRequest = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(req.jsonSchema),
      },
    };
    const url = `${geminiConfig.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`;
    const res = await postJson<GeminiGenerateResponse>("gemini", url, body, { headers: headers(), signal: req.signal });
    const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { data: parseJsonLoose(text), tokensIn: res.usageMetadata?.promptTokenCount, tokensOut: res.usageMetadata?.candidatesTokenCount };
  }

  async embed(req: ProviderEmbedRequest): Promise<number[][]> {
    const body: GeminiBatchEmbedRequest = {
      requests: req.texts.map((text) => ({
        model: `models/${req.model}`,
        content: { parts: [{ text }] },
        taskType: req.kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        ...(req.dims ? { outputDimensionality: req.dims } : {}),
      })),
    };
    const url = `${geminiConfig.baseUrl}/models/${encodeURIComponent(req.model)}:batchEmbedContents`;
    const res = await postJson<GeminiBatchEmbedResponse>("gemini", url, body, { headers: headers(), signal: req.signal });
    return res.embeddings.map((e) => e.values);
  }
}

export const createGeminiProvider = (): GeminiProvider => new GeminiProvider();
