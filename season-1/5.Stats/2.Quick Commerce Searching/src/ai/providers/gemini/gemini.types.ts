// Gemini REST shapes (only the fields this app uses)

export interface GeminiGenerateRequest {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType: "application/json";
    responseSchema: unknown;
  };
}

export interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export type GeminiTaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

export interface GeminiBatchEmbedRequest {
  requests: Array<{
    model: string;
    content: { parts: Array<{ text: string }> };
    taskType: GeminiTaskType;
    outputDimensionality?: number;
  }>;
}

export interface GeminiBatchEmbedResponse {
  embeddings: Array<{ values: number[] }>;
}
