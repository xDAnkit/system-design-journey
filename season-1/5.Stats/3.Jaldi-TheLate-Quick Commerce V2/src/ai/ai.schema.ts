import { z } from "zod";

type Json = Record<string, unknown>;

/** One zod schema in, plain JSON Schema out. Every provider turns this into its own structured output format. */
export const toJsonSchema = (schema: z.ZodType): Json => {
  const json = { ...(z.toJSONSchema(schema) as Json) };
  delete json.$schema;
  return json;
};

// Gemini's responseSchema is an OpenAPI subset: uppercase types, no additionalProperties, nullable flag.
const GEMINI_KEYS = new Set(["type", "description", "enum", "items", "properties", "required", "minItems", "maxItems", "nullable", "format"]);

export const toGeminiSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const src = node as Json;
  const out: Json = {};
  for (const [key, value] of Object.entries(src)) {
    if (!GEMINI_KEYS.has(key)) continue;
    if (key === "type") {
      const types = (Array.isArray(value) ? value : [value]).map(String);
      const main = types.find((t) => t !== "null") ?? "string";
      out.type = main.toUpperCase();
      if (types.includes("null")) out.nullable = true;
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

/** First {...} block of a reply, or null. Guards against stray text around the JSON. */
export const parseJsonLoose = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};
