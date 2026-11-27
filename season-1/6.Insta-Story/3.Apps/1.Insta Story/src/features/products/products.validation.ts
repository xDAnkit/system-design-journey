import { httpError } from "../../shared/error.js";
import type { CreateProductInput, UpdateProductInput } from "./products.types.js";

// ponytail: haath se likhi validation, yaha type shape simple hai — zod poore app me sirf env ke liye
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNonNegNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isNonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export const validateCreate = (body: unknown): CreateProductInput => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(b.name)) throw httpError(400, "name (non-empty string) required");
  if (!isNonEmptyString(b.description)) throw httpError(400, "description (non-empty string) required");
  if (!isNonNegNumber(b.price)) throw httpError(400, "price (number >= 0) required");
  if (!isNonNegInt(b.stock)) throw httpError(400, "stock must be an integer >= 0");
  if (!isNonEmptyString(b.category)) throw httpError(400, "category (non-empty string) required");
  if (!isNonEmptyString(b.imageUrl)) throw httpError(400, "imageUrl (non-empty string) required");

  return {
    name: b.name.trim(),
    description: b.description.trim(),
    price: b.price,
    stock: b.stock,
    category: b.category.trim(),
    imageUrl: b.imageUrl.trim(),
  };
};

// PUT me sirf wahi fields lete hain jo bheji gayi hain
export const validateUpdate = (body: unknown): UpdateProductInput => {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: UpdateProductInput = {};

  if (b.name !== undefined) {
    if (!isNonEmptyString(b.name)) throw httpError(400, "name must be a non-empty string");
    patch.name = b.name.trim();
  }
  if (b.description !== undefined) {
    if (!isNonEmptyString(b.description)) throw httpError(400, "description must be a non-empty string");
    patch.description = b.description.trim();
  }
  if (b.price !== undefined) {
    if (!isNonNegNumber(b.price)) throw httpError(400, "price must be a number >= 0");
    patch.price = b.price;
  }
  if (b.stock !== undefined) {
    if (!isNonNegInt(b.stock)) throw httpError(400, "stock must be an integer >= 0");
    patch.stock = b.stock;
  }
  if (b.category !== undefined) {
    if (!isNonEmptyString(b.category)) throw httpError(400, "category must be a non-empty string");
    patch.category = b.category.trim();
  }
  if (b.imageUrl !== undefined) {
    if (!isNonEmptyString(b.imageUrl)) throw httpError(400, "imageUrl must be a non-empty string");
    patch.imageUrl = b.imageUrl.trim();
  }
  if (Object.keys(patch).length === 0) throw httpError(400, "at least one field required to update");

  return patch;
};
