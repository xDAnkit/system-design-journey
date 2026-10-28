// Ollama REST API shapes (only the fields this app uses)

export interface OllamaGenerateRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON Schema: Ollama constrains the output to it */
  format: Record<string, unknown>;
  stream: false;
  keep_alive: string;
  think?: false;
  options: { temperature: number; seed: number; num_ctx: number; num_predict: number };
}

export interface OllamaGenerateResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

export interface OllamaEmbedRequest {
  model: string;
  input: string[];
  keep_alive: string;
}

export interface OllamaEmbedResponse {
  embeddings: number[][];
}
