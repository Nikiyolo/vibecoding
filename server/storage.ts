import { db } from "./db";
import { performanceMetrics, type InsertPerformanceMetric } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  getMetrics(): Promise<typeof performanceMetrics.$inferSelect[]>;
  createMetric(metric: InsertPerformanceMetric): Promise<typeof performanceMetrics.$inferSelect>;
  seedMetrics(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getMetrics() {
    return await db.select().from(performanceMetrics);
  }

  async createMetric(metric: InsertPerformanceMetric) {
    const [inserted] = await db.insert(performanceMetrics).values(metric).returning();
    return inserted;
  }
  
  async seedMetrics() {
    const existing = await this.getMetrics();
    if (existing.length > 0) return;
    
    // Generate 12 months of simulated data
    const products = ["Product A", "Product B", "Product C"];
    const regions = ["North America", "Europe", "Asia"];
    
    const baseDate = new Date();
    baseDate.setMonth(baseDate.getMonth() - 12);
    
    for (let i = 0; i < 12; i++) {
      const date = new Date(baseDate);
      date.setMonth(baseDate.getMonth() + i);
      
      for (const product of products) {
        for (const region of regions) {
          // Add some randomness and a trend
          const trend = i * 100;
          const revenue = 1000 + Math.random() * 500 + trend;
          const cost = 600 + Math.random() * 300 + (trend * 0.5);
          const profit = revenue - cost;
          
          await this.createMetric({
            date,
            product,
            region,
            revenue: revenue.toFixed(2),
            cost: cost.toFixed(2),
            profit: profit.toFixed(2)
          });
        }
      }
    }
  }
}

export const storage = new DatabaseStorage();
