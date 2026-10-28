import type { z } from "zod";
import { httpError } from "./error.js";

/** zod parse that answers 400 with the first problem ("price: Expected number") instead of throwing a ZodError */
export const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw httpError(400, `${issue?.path.join(".") || "input"}: ${issue?.message ?? "invalid"}`);
  }
  return result.data;
};
