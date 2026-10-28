import { z } from "zod";
import "../../../bootstrap/env.js"; // loads .env before process.env is read

const optional = (s: z.ZodType) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());

const schema = z.object({
  GEMINI_API_KEY: optional(z.string().min(1)),
  GEMINI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta"),
});

const parsed = schema.parse(process.env);

export const geminiConfig = {
  apiKey: parsed.GEMINI_API_KEY as string | undefined,
  baseUrl: parsed.GEMINI_BASE_URL.replace(/\/+$/, ""),
};

export const isGeminiConfigured = (): boolean => Boolean(geminiConfig.apiKey);
