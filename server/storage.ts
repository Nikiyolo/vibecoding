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
    
    // Generate 12 months of simulated data with declining revenue trend
    const products = ["Product A", "Product B", "Product C"];
    const regions = ["North America", "Europe", "Asia"];
    
    const baseDate = new Date();
    baseDate.setMonth(baseDate.getMonth() - 12);
    
    for (let i = 0; i < 12; i++) {
      const date = new Date(baseDate);
      date.setMonth(baseDate.getMonth() + i);
      
      for (const product of products) {
        for (const region of regions) {
          // Create a declining trend: start high and go lower each month
          // Base revenue starts at ~2500-3500 and declines to ~1200-1800 by month 12
          const baseRevenue = 3000 - (i * 150); // Declining by ~150 per month
          const variance = Math.random() * 200 - 100; // ±100 variance
          const productMultiplier = product === "Product A" ? 0.9 : (product === "Product B" ? 1.0 : 1.1); // Product A underperforms
          const regionMultiplier = region === "Europe" ? 0.85 : (region === "Asia" ? 1.0 : 1.15); // Europe underperforms
          
          const revenue = (baseRevenue + variance) * productMultiplier * regionMultiplier;
          const cost = revenue * 0.6; // Consistent 60% cost ratio
          const profit = revenue - cost;
          
          await this.createMetric({
            date,
            product,
            region,
            revenue: Math.max(0, revenue).toFixed(2),
            cost: cost.toFixed(2),
            profit: Math.max(0, profit).toFixed(2)
          });
        }
      }
    }
  }
}

export const storage = new DatabaseStorage();
