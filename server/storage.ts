import { db } from "./db";
import { 
  performanceMetrics, 
  productCategories, 
  productSubcategories,
  materialCodes,
  skus,
  type InsertPerformanceMetric,
  type InsertProductCategory,
  type InsertProductSubcategory,
  type InsertMaterialCode,
  type InsertSku
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  getMetrics(): Promise<typeof performanceMetrics.$inferSelect[]>;
  createMetric(metric: InsertPerformanceMetric): Promise<typeof performanceMetrics.$inferSelect>;
  seedMetrics(): Promise<void>;
  seedProductHierarchy(): Promise<void>;
  getProductCategories(): Promise<typeof productCategories.$inferSelect[]>;
  getSkus(): Promise<typeof skus.$inferSelect[]>;
}

export class DatabaseStorage implements IStorage {
  async getMetrics() {
    return await db.select().from(performanceMetrics);
  }

  async createMetric(metric: InsertPerformanceMetric) {
    const [inserted] = await db.insert(performanceMetrics).values(metric).returning();
    return inserted;
  }

  async getProductCategories() {
    return await db.select().from(productCategories);
  }

  async getSkus() {
    return await db.select().from(skus);
  }

  async seedProductHierarchy() {
    // Check if hierarchy already exists
    const existing = await this.getProductCategories();
    if (existing.length > 0) return;

    // Define the product hierarchy structure
    const hierarchy = [
      {
        category: "Electronics",
        subcategories: [
          {
            name: "Computing",
            materials: [
              { code: "MTL-ELC-001", desc: "Computer Processing Unit", skus: ["SKU-CPU-001", "SKU-CPU-002", "SKU-CPU-003"] },
              { code: "MTL-ELC-002", desc: "Motherboard Assembly", skus: ["SKU-MB-001", "SKU-MB-002"] }
            ]
          },
          {
            name: "Peripherals",
            materials: [
              { code: "MTL-ELC-003", desc: "Wireless Mouse", skus: ["SKU-MOUSE-001", "SKU-MOUSE-002"] },
              { code: "MTL-ELC-004", desc: "USB Keyboard", skus: ["SKU-KB-001", "SKU-KB-002", "SKU-KB-003"] }
            ]
          }
        ]
      },
      {
        category: "Furniture",
        subcategories: [
          {
            name: "Office Desks",
            materials: [
              { code: "MTL-FUR-001", desc: "Wooden Desk Frame", skus: ["SKU-DESK-001", "SKU-DESK-002"] },
              { code: "MTL-FUR-002", desc: "Standing Desk Motor", skus: ["SKU-SDESK-001", "SKU-SDESK-002"] }
            ]
          },
          {
            name: "Seating",
            materials: [
              { code: "MTL-FUR-003", desc: "Office Chair Base", skus: ["SKU-CHAIR-001", "SKU-CHAIR-002", "SKU-CHAIR-003"] },
              { code: "MTL-FUR-004", desc: "Ergonomic Cushion", skus: ["SKU-CUSH-001", "SKU-CUSH-002"] }
            ]
          }
        ]
      },
      {
        category: "Software",
        subcategories: [
          {
            name: "Productivity",
            materials: [
              { code: "MTL-SFT-001", desc: "Office Suite License", skus: ["SKU-OFFICE-001", "SKU-OFFICE-002"] },
              { code: "MTL-SFT-002", desc: "Project Management Tool", skus: ["SKU-PM-001", "SKU-PM-002"] }
            ]
          },
          {
            name: "Development",
            materials: [
              { code: "MTL-SFT-003", desc: "IDE License", skus: ["SKU-IDE-001", "SKU-IDE-002", "SKU-IDE-003"] },
              { code: "MTL-SFT-004", desc: "Version Control System", skus: ["SKU-VCS-001"] }
            ]
          }
        ]
      }
    ];

    // Insert hierarchy
    for (const cat of hierarchy) {
      const [categoryRow] = await db.insert(productCategories).values({ categoryName: cat.category }).returning();
      
      for (const subcat of cat.subcategories) {
        const [subcategoryRow] = await db.insert(productSubcategories).values({
          categoryId: categoryRow.id,
          subcategoryName: subcat.name
        }).returning();

        for (const material of subcat.materials) {
          const [materialRow] = await db.insert(materialCodes).values({
            subcategoryId: subcategoryRow.id,
            materialCode: material.code,
            materialDescription: material.desc
          }).returning();

          for (const sku of material.skus) {
            await db.insert(skus).values({
              materialCodeId: materialRow.id,
              sku,
              skuDescription: `${material.desc} - ${sku}`
            });
          }
        }
      }
    }
  }
  
  async seedMetrics() {
    // Ensure product hierarchy exists first
    await this.seedProductHierarchy();

    const allSkus = await this.getSkus();
    
    if (allSkus.length === 0) return;

    // Check if we have metrics with SKU IDs (new format)
    const allMetrics = await this.getMetrics();
    const hasSkuMetrics = allMetrics.some(m => m.skuId !== null);
    
    // If we already have SKU-based metrics, don't reseed
    if (hasSkuMetrics) return;

    const regions = ["North America", "Europe", "Asia"];
    const baseDate = new Date();
    baseDate.setMonth(baseDate.getMonth() - 12);

    // Delete old product-based metrics
    if (allMetrics.length > 0) {
      await db.delete(performanceMetrics);
    }

    // Generate 12 months of data for each SKU and region
    for (let i = 0; i < 12; i++) {
      const date = new Date(baseDate);
      date.setMonth(baseDate.getMonth() + i);

      for (const sku of allSkus) {
        for (const region of regions) {
          // Varying revenue patterns based on SKU and region
          const baseRevenue = 1500 - (i * 80);
          const variance = Math.random() * 150 - 75;
          const skuMultiplier = 0.8 + Math.random() * 0.6; // SKUs vary more
          const regionMultiplier = region === "Europe" ? 0.85 : (region === "Asia" ? 1.0 : 1.15);

          const revenue = Math.max(100, (baseRevenue + variance) * skuMultiplier * regionMultiplier);
          const cost = revenue * 0.6;
          const profit = revenue - cost;

          await this.createMetric({
            date,
            skuId: sku.id,
            region,
            revenue: revenue.toFixed(2),
            cost: cost.toFixed(2),
            profit: Math.max(0, profit).toFixed(2)
          });
        }
      }
    }
  }
}

export const storage = new DatabaseStorage();
