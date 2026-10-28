import { AiError } from "../ai.types.js";

/**
 * POST JSON with built-in fetch. Every failure becomes an AiError:
 * network errors, timeouts, 429 and 5xx are retryable, other 4xx are not.
 * Messages never contain the URL or headers, so API keys can't leak into logs.
 */
export async function postJson<T>(
  provider: string,
  url: string,
  body: unknown,
  { headers = {}, signal }: { headers?: Record<string, string>; signal: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const reason = name === "TimeoutError" || name === "AbortError" ? "request timed out" : `network error (${err instanceof Error ? err.message : String(err)})`;
    throw new AiError(`${provider}: ${reason}`, provider, true);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    throw new AiError(`${provider}: HTTP ${res.status} ${detail}`, provider, res.status === 429 || res.status >= 500, res.status);
  }
  return (await res.json()) as T;
}
