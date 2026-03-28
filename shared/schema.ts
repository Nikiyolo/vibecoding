import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const performanceMetrics = pgTable("performance_metrics", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  product: text("product").notNull(),
  region: text("region").notNull(),
  revenue: numeric("revenue").notNull(),
  cost: numeric("cost").notNull(),
  profit: numeric("profit").notNull(),
});

export const insertPerformanceMetricSchema = createInsertSchema(performanceMetrics).omit({ id: true });

export type InsertPerformanceMetric = z.infer<typeof insertPerformanceMetricSchema>;
export type PerformanceMetric = typeof performanceMetrics.$inferSelect;
