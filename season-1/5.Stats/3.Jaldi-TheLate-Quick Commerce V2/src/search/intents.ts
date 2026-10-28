import { has, normalize } from "../ai/tagging/tag-rules.js";
import data from "./intents.json";

const INTENTS = data.intents.map((i) => ({ match: i.match.map(normalize), boost: i.boost }));

/** Categories the query's intent points at ("mujhe chai peeni hai" -> tea, milk, sugar...). Order = strength. */
export const matchIntents = (...texts: Array<string | null | undefined>): string[] => {
  const text = normalize(texts.filter(Boolean).join(" "));
  const out: string[] = [];
  for (const intent of INTENTS) {
    if (!intent.match.some((m) => has(text, m))) continue;
    for (const c of intent.boost) if (!out.includes(c)) out.push(c);
  }
  return out;
};
