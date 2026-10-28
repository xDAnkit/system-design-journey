export type SizeUnit = "ml" | "g" | "pcs";

export interface ParsedSize {
  qty: number;
  unit: SizeUnit;
}

const UNIT: Record<string, [SizeUnit, number]> = {
  ml: ["ml", 1],
  l: ["ml", 1000],
  ltr: ["ml", 1000],
  litre: ["ml", 1000],
  liter: ["ml", 1000],
  g: ["g", 1],
  gm: ["g", 1],
  gms: ["g", 1],
  gram: ["g", 1],
  grams: ["g", 1],
  kg: ["g", 1000],
  kilo: ["g", 1000],
  pc: ["pcs", 1],
  pcs: ["pcs", 1],
  piece: ["pcs", 1],
  pieces: ["pcs", 1],
  bags: ["pcs", 1],
  sticks: ["pcs", 1],
  dozen: ["pcs", 12],
};

/**
 * "500 ml" -> 500 ml, "1 L" -> 1000 ml, "1.25 L" -> 1250 ml, "4 x 100 g" -> 100 g (one unit), "6 pcs" -> 6 pcs.
 * Sizes like "9 m" have no unit we filter on, so they return null.
 */
export const parseSize = (size: string): ParsedSize | null => {
  const m = size
    .toLowerCase()
    .replace(/^\d+\s*x\s*/, "")
    .match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (!m) return null;
  const unit = UNIT[m[2]];
  if (!unit) return null;
  return { qty: Math.round(Number(m[1]) * unit[1]), unit: unit[0] };
};
