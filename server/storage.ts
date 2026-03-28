import { db } from "./db";
import { 
  performanceMetrics, 
  productCategories, 
  productSubcategories,
  materialCodes,
  skus,
  type InsertPerformanceMetric
} from "@shared/schema";

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

  private async seedProductHierarchy() {
    const existing = await db.select().from(productCategories);
    if (existing.length > 0) return;

    const hierarchy = [
      {
        category: "Electronics",
        subcategories: [
          {
            name: "Computing",
            materials: [
              { code: "CPU-001", desc: "Processors", skus: ["SKU-CPU-A", "SKU-CPU-B", "SKU-CPU-C"] },
              { code: "MB-001", desc: "Motherboards", skus: ["SKU-MB-A", "SKU-MB-B"] }
            ]
          },
          {
            name: "Peripherals",
            materials: [
              { code: "MOUSE-001", desc: "Wireless Mice", skus: ["SKU-MOUSE-A", "SKU-MOUSE-B"] },
              { code: "KB-001", desc: "Keyboards", skus: ["SKU-KB-A", "SKU-KB-B", "SKU-KB-C"] }
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
              { code: "DESK-001", desc: "Wooden Desks", skus: ["SKU-DESK-A", "SKU-DESK-B"] },
              { code: "SDESK-001", desc: "Standing Desks", skus: ["SKU-SDESK-A", "SKU-SDESK-B"] }
            ]
          },
          {
            name: "Seating",
            materials: [
              { code: "CHAIR-001", desc: "Office Chairs", skus: ["SKU-CHAIR-A", "SKU-CHAIR-B", "SKU-CHAIR-C"] },
              { code: "CUSHION-001", desc: "Cushions", skus: ["SKU-CUSH-A", "SKU-CUSH-B"] }
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
              { code: "OFFICE-001", desc: "Office Suites", skus: ["SKU-OFFICE-A", "SKU-OFFICE-B"] },
              { code: "PM-001", desc: "Project Management", skus: ["SKU-PM-A", "SKU-PM-B"] }
            ]
          },
          {
            name: "Development",
            materials: [
              { code: "IDE-001", desc: "IDEs", skus: ["SKU-IDE-A", "SKU-IDE-B", "SKU-IDE-C"] },
              { code: "VCS-001", desc: "Version Control", skus: ["SKU-VCS-A"] }
            ]
          }
        ]
      }
    ];

    for (const cat of hierarchy) {
      const [catRow] = await db.insert(productCategories).values({ categoryName: cat.category }).returning();
      for (const subcat of cat.subcategories) {
        const [subcatRow] = await db.insert(productSubcategories).values({
          categoryId: catRow.id,
          subcategoryName: subcat.name
        }).returning();
        for (const mat of subcat.materials) {
          const [matRow] = await db.insert(materialCodes).values({
            subcategoryId: subcatRow.id,
            materialCode: mat.code,
            materialDescription: mat.desc
          }).returning();
          for (const sku of mat.skus) {
            await db.insert(skus).values({
              materialCodeId: matRow.id,
              sku,
              skuDescription: `${mat.desc} - ${sku}`
            });
          }
        }
      }
    }
  }
  
  async seedMetrics() {
    await this.seedProductHierarchy();
    // Only seed if the table is empty — never wipe existing data on restart
    const existing = await this.getMetrics();
    if (existing.length > 0) return;

    const allSkus = await db.select().from(skus);
    if (allSkus.length === 0) return;

    const regions = ["North America", "Europe", "Asia"];
    const baseDate = new Date();
    baseDate.setMonth(baseDate.getMonth() - 12);

    // Deterministic PRNG — same seed always produces the same float in [0, 1]
    // so values never change between restarts.
    const prng = (seed: number): number => {
      let s = seed ^ 0xdeadbeef;
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
      s = Math.imul(s ^ (s >>> 13), 0x1b873593);
      s = s ^ (s >>> 16);
      return (s >>> 0) / 0xffffffff;
    };

    for (let i = 0; i < 12; i++) {
      const date = new Date(baseDate);
      date.setMonth(baseDate.getMonth() + i);

      for (let si = 0; si < allSkus.length; si++) {
        const sku = allSkus[si];
        for (let ri = 0; ri < regions.length; ri++) {
          const region = regions[ri];
          const baseRevenue = 1500 - (i * 80);

          // Seeds are fully determined by (month, SKU index, region index)
          const seed = i * 10000 + si * 100 + ri;
          const variance = prng(seed)       * 150 - 75;   // [-75, +75]
          const skuMultiplier = 0.8 + prng(seed + 50000) * 0.6; // [0.8, 1.4]
          const regionMultiplier =
            region === "Europe" ? 0.85 : region === "Asia" ? 1.0 : 1.15;

          const revenue = Math.max(100, (baseRevenue + variance) * skuMultiplier * regionMultiplier);

          // Cost ratio by category — Electronics 45%, Furniture 55%, Software 35%
          let costRatio = 0.55;
          if (sku.sku.includes("CHAIR") || sku.sku.includes("DESK") || sku.sku.includes("CUSH")) {
            costRatio = 0.55;
          } else if (sku.sku.includes("OFFICE") || sku.sku.includes("IDE") || sku.sku.includes("PM") || sku.sku.includes("VCS")) {
            costRatio = 0.35;
          } else {
            costRatio = 0.45;
          }
          costRatio += i * 0.01; // margins tighten slightly over time

          const cost = revenue * costRatio;
          const profit = revenue - cost;

          await this.createMetric({
            date,
            skuId: sku.id,
            region,
            revenue: revenue.toFixed(2),
            cost: cost.toFixed(2),
            profit: profit.toFixed(2),
          });
        }
      }
    }
  }
}

export const storage = new DatabaseStorage();
