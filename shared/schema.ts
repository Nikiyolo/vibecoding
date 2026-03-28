import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Product Dimension Hierarchy
export const productCategories = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  categoryName: text("category_name").notNull().unique(),
});

export const productSubcategories = pgTable("product_subcategories", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  subcategoryName: text("subcategory_name").notNull(),
});

export const materialCodes = pgTable("material_codes", {
  id: serial("id").primaryKey(),
  subcategoryId: integer("subcategory_id").notNull(),
  materialCode: text("material_code").notNull().unique(),
  materialDescription: text("material_description"),
});

export const skus = pgTable("skus", {
  id: serial("id").primaryKey(),
  materialCodeId: integer("material_code_id").notNull(),
  sku: text("sku").notNull().unique(),
  skuDescription: text("sku_description"),
});

// Performance Metrics - linked to SKU with revenue, cost, profit for margin calculation
export const performanceMetrics = pgTable("performance_metrics", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  skuId: integer("sku_id").notNull(),
  region: text("region").notNull(),
  revenue: numeric("revenue").notNull(),
  cost: numeric("cost").notNull(),
  profit: numeric("profit").notNull(),
});

// Schemas
export const insertProductCategorySchema = createInsertSchema(productCategories).omit({ id: true });
export const insertProductSubcategorySchema = createInsertSchema(productSubcategories).omit({ id: true });
export const insertMaterialCodeSchema = createInsertSchema(materialCodes).omit({ id: true });
export const insertSkuSchema = createInsertSchema(skus).omit({ id: true });
export const insertPerformanceMetricSchema = createInsertSchema(performanceMetrics).omit({ id: true });

// Types
export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;
export type ProductCategory = typeof productCategories.$inferSelect;

export type InsertProductSubcategory = z.infer<typeof insertProductSubcategorySchema>;
export type ProductSubcategory = typeof productSubcategories.$inferSelect;

export type InsertMaterialCode = z.infer<typeof insertMaterialCodeSchema>;
export type MaterialCode = typeof materialCodes.$inferSelect;

export type InsertSku = z.infer<typeof insertSkuSchema>;
export type Sku = typeof skus.$inferSelect;

export type InsertPerformanceMetric = z.infer<typeof insertPerformanceMetricSchema>;
export type PerformanceMetric = typeof performanceMetrics.$inferSelect;
