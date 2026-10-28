import mongoose, { Schema } from "mongoose";
import { emptyTagSet } from "../../ai/tagging/tag.types.js";
import type { Product } from "./products.types.js";

const productSchema = new Schema<Product>(
  {
    name: { type: String, required: true, trim: true },
    brand: { type: String, default: "" },
    category: { type: String, required: true },
    baseKey: { type: String, default: null },
    size: { type: String, default: "" },
    sizeQty: { type: Number, default: null },
    sizeUnit: { type: String, enum: ["ml", "g", "pcs"], default: null },
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    icon: { type: String, default: "shopping_basket" },
    storeIds: { type: [String], default: [] },
    // { en, hinglish, native: { Hindi: [...], Tamil: [...] }, typos, ai }
    tags: { type: Schema.Types.Mixed, default: emptyTagSet },
    tagsSource: { type: String, enum: ["kb", "kb+ai", "admin"], default: "kb" },
    tagsFor: { type: String, default: "" },
    suggestedTags: { type: [String], default: [] },
    embedKey: { type: String, default: null },
    status: { type: String, enum: ["pending", "enriched", "indexed", "failed"], default: "pending" },
    error: { type: String, default: null },
    popularity: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);

productSchema.index({ category: 1 });
productSchema.index({ status: 1, updatedAt: 1 });
productSchema.index({ baseKey: 1 });

export const ProductModel = mongoose.model<Product>("Product", productSchema);
