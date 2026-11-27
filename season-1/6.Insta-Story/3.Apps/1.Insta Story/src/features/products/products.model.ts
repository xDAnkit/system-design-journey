import mongoose, { Schema } from "mongoose";
import type { ProductDocument } from "./products.types.js";

const productSchema = new Schema<ProductDocument>(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Product price is required"],
      min: 0,
    },
    stock: {
      type: Number,
      required: [true, "Product stock is required"],
      min: 0,
    },
    category: {
      type: String,
      required: [true, "Product category is required"],
      trim: true,
    },
    imageUrl: {
      type: String,
      required: [true, "Product image URL is required"],
    },
  },
  { timestamps: true },
);

// Indexes
productSchema.index({ name: "text" });
productSchema.index({ category: 1 });

export const Product = mongoose.model<ProductDocument>(
  "Product",
  productSchema,
);
