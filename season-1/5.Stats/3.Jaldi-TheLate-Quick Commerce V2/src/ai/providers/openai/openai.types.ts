// OpenAI Chat Completions and Embeddings shapes (only the fields this app uses)

export interface OpenAiChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } };
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export interface OpenAiChatResponse {
  choices: Array<{ message: { content: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiEmbedRequest {
  model: string;
  input: string[];
  dimensions?: number;
}

export interface OpenAiEmbedResponse {
  data: Array<{ index: number; embedding: number[] }>;
}
