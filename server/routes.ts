import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { openai } from "./replit_integrations/image/client"; // Reusing the OpenAI client from the AI integrations module
import { performanceMetrics, skus, materialCodes, productSubcategories, productCategories } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seed the database on startup
  await storage.seedMetrics().catch(console.error);

  app.get(api.metrics.list.path, async (req, res) => {
    try {
      const metrics = await storage.getMetrics();
      res.json(metrics);
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  app.post(api.analyze.query.path, async (req, res) => {
    try {
      const input = api.analyze.query.input.parse(req.body);
      const query = input.query;
      
      // Call OpenAI to parse the natural language query and extract intent
      const systemPrompt = `You are a data analysis assistant. Parse the user's query and extract the following:
      1. metric: The metric they are asking about (revenue, cost, profit, etc.). Map to 'revenue', 'cost', or 'profit'. If unmapped, use the term they used.
      2. timeRange: The time period they are asking about (e.g., 'last month', 'last year', 'all time').
      3. intent: 'trend' (if they want to see how it changes over time) or 'root_cause' (if they are asking 'why' it changed).
      
      Return as JSON with keys: metric, timeRange, intent.`;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        response_format: { type: "json_object" }
      });
      
      let interpretation = { metric: "revenue", timeRange: "all time", intent: "trend" };
      try {
        const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
        interpretation = { ...interpretation, ...parsed };
      } catch (e) {
        console.error("Failed to parse intent", e);
      }
      
      const allowedMetrics = ["revenue", "cost", "profit"];
      if (!allowedMetrics.includes(interpretation.metric.toLowerCase())) {
        // Fallback to revenue if unknown, or we could return an error message to display
        interpretation.metric = "revenue"; 
      }
      
      // Fetch data
      const allData = await storage.getMetrics();
      
      // Simple logic to mock the analysis based on data
      // For a real app, you would filter data by timeRange, group by date/product/region etc.
      
      // Check if query asks for "highest" to identify specific dimension request
      const isHighestQuery = query.toLowerCase().includes("highest") || query.toLowerCase().includes("top");
      
      // Force "trend" intent for highest/top queries (they are factual, not causal)
      if (isHighestQuery) {
        interpretation.intent = "trend";
      }
      
      let topCategory: string | null = null;
      
      // Aggregate by month for trend - will be filtered if topCategory is identified
      const trendMap = new Map();
      
      // Build SKU to category mapping first (needed for profit margin calculation)
      const skuMap = new Map<number, { category: string; subcategory: string; material: string; sku: string }>();
      const allSkus = await db.select().from(skus);
      
      for (const sku of allSkus) {
        const materialRow = await db.select().from(materialCodes).where(eq(materialCodes.id, sku.materialCodeId)).then(r => r[0]);
        if (materialRow) {
          const subcategoryRow = await db.select().from(productSubcategories).where(eq(productSubcategories.id, materialRow.subcategoryId)).then(r => r[0]);
          if (subcategoryRow) {
            const categoryRow = await db.select().from(productCategories).where(eq(productCategories.id, subcategoryRow.categoryId)).then(r => r[0]);
            skuMap.set(sku.id, {
              category: categoryRow?.categoryName || "Unknown",
              subcategory: subcategoryRow.subcategoryName,
              material: materialRow.materialCode,
              sku: sku.sku
            });
          }
        }
      }

      // Helper function to determine if a date matches the requested time range
      const dateMatchesTimeRange = (dateStr: string, timeRange: string | null): boolean => {
        if (!timeRange) return true;
        const year = dateStr.slice(0, 4);
        const month = dateStr.slice(5, 7);
        const lowerTimeRange = timeRange.toLowerCase();
        
        // Check for year (e.g., "2023", "2024")
        if (/^\d{4}$/.test(timeRange)) {
          return year === timeRange;
        }
        
        if (lowerTimeRange.includes("q1")) return ["01", "02", "03"].includes(month);
        if (lowerTimeRange.includes("q2")) return ["04", "05", "06"].includes(month);
        if (lowerTimeRange.includes("q3")) return ["07", "08", "09"].includes(month);
        if (lowerTimeRange.includes("q4")) return ["10", "11", "12"].includes(month);
        
        // If specific month mentioned, match it
        if (lowerTimeRange.includes("january") || lowerTimeRange.includes("jan")) return month === "01";
        if (lowerTimeRange.includes("february") || lowerTimeRange.includes("feb")) return month === "02";
        if (lowerTimeRange.includes("march") || lowerTimeRange.includes("mar")) return month === "03";
        if (lowerTimeRange.includes("april") || lowerTimeRange.includes("apr")) return month === "04";
        if (lowerTimeRange.includes("may")) return month === "05";
        if (lowerTimeRange.includes("june") || lowerTimeRange.includes("jun")) return month === "06";
        if (lowerTimeRange.includes("july") || lowerTimeRange.includes("jul")) return month === "07";
        if (lowerTimeRange.includes("august") || lowerTimeRange.includes("aug")) return month === "08";
        if (lowerTimeRange.includes("september") || lowerTimeRange.includes("sep")) return month === "09";
        if (lowerTimeRange.includes("october") || lowerTimeRange.includes("oct")) return month === "10";
        if (lowerTimeRange.includes("november") || lowerTimeRange.includes("nov")) return month === "11";
        if (lowerTimeRange.includes("december") || lowerTimeRange.includes("dec")) return month === "12";
        
        return true; // Default to all if no time range matched
      };
      
      // Detect dimension from query (by region, by category, by product, etc.)
      const detectBreakdownDimension = (query: string): "region" | "category" => {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.includes("by region") || lowerQuery.includes("by regions")) return "region";
        if (lowerQuery.includes("by category") || lowerQuery.includes("by categories")) return "category";
        if (lowerQuery.includes("by product")) return "category";
        // Default to region if "breakdown" is mentioned without specifying dimension
        if (lowerQuery.includes("breakdown")) return "region";
        return "category"; // Default fallback
      };
      
      // If asking for profit margin, calculate it per category
      if (interpretation.metric === "profit" && isHighestQuery) {
        // Calculate average profit margin by category (filtered by time range)
        const marginByCategory = new Map<string, { total: number; count: number }>();
        allData.forEach(d => {
          const dateStr = new Date(d.date).toISOString().slice(0, 7);
          if (!dateMatchesTimeRange(dateStr, interpretation.timeRange)) return;
          
          const hierarchy = skuMap.get(d.skuId);
          const categoryName = hierarchy?.category || "Unknown";
          const revenue = Number(d.revenue) || 0;
          const profit = Number(d.profit) || 0;
          const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
          
          if (!marginByCategory.has(categoryName)) {
            marginByCategory.set(categoryName, { total: 0, count: 0 });
          }
          const entry = marginByCategory.get(categoryName)!;
          entry.total += profitMargin;
          entry.count += 1;
        });
        
        // Find top category by average profit margin
        let maxMargin = -1;
        for (const [cat, data] of marginByCategory) {
          const avgMargin = data.total / data.count;
          if (avgMargin > maxMargin) {
            maxMargin = avgMargin;
            topCategory = cat;
          }
        }
      }
      
      // For highest queries, aggregate trend data by category (multi-series)
      // Otherwise, aggregate as a single trend line
      let trendData: any[] = [];
      
      if (isHighestQuery && interpretation.metric === "profit") {
        // Build multi-series data by category
        const categoryTrendMap = new Map<string, Map<string, { value: number; count: number }>>();
        
        allData.forEach(d => {
          const dateKey = new Date(d.date).toISOString().slice(0, 7);
          if (interpretation.timeRange && !dateMatchesTimeRange(dateKey, interpretation.timeRange)) return;
          
          const hierarchy = skuMap.get(d.skuId);
          const categoryName = hierarchy?.category || "Unknown";
          const revenue = Number(d.revenue) || 0;
          const profit = Number(d.profit) || 0;
          const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
          
          if (!categoryTrendMap.has(categoryName)) {
            categoryTrendMap.set(categoryName, new Map());
          }
          const catMap = categoryTrendMap.get(categoryName)!;
          if (!catMap.has(dateKey)) {
            catMap.set(dateKey, { value: 0, count: 0 });
          }
          const entry = catMap.get(dateKey)!;
          entry.value += profitMargin;
          entry.count += 1;
        });
        
        // Format as multi-series data: [{date, Category1: 55, Category2: 45, ...}, ...]
        const dateSet = new Set<string>();
        categoryTrendMap.forEach(catMap => {
          catMap.forEach((_, dateKey) => dateSet.add(dateKey));
        });
        
        const dates = Array.from(dateSet).sort();
        trendData = dates.map(dateKey => {
          const row: any = { date: dateKey };
          categoryTrendMap.forEach((catMap, categoryName) => {
            const entry = catMap.get(dateKey);
            row[categoryName] = entry ? parseFloat((entry.value / entry.count).toFixed(2)) : 0;
          });
          return row;
        });
      } else {
        // Single series trend data
        allData.forEach(d => {
          const dateKey = new Date(d.date).toISOString().slice(0, 7); // YYYY-MM
          
          // Filter by time range if specified
          if (interpretation.timeRange && !dateMatchesTimeRange(dateKey, interpretation.timeRange)) return;
          
          if (!trendMap.has(dateKey)) {
            trendMap.set(dateKey, { date: dateKey, value: 0, count: 0 });
          }
          const entry = trendMap.get(dateKey)!;
          
          // Calculate profit margin if metric is profit
          if (interpretation.metric === "profit") {
            const revenue = Number(d.revenue) || 0;
            const profit = Number(d.profit) || 0;
            const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
            entry.value += profitMargin;
          } else {
            entry.value += Number(d[interpretation.metric as keyof typeof d] || 0);
          }
          entry.count += 1;
        });
        
        // Average the values
        trendData = Array.from(trendMap.values()).map(item => ({
          date: item.date,
          value: interpretation.metric === "profit" && item.count > 0 
            ? parseFloat((item.value / item.count).toFixed(2))
            : item.value
        })).sort((a, b) => a.date.localeCompare(b.date));
      }
      
      // Detect breakdown dimension and aggregate data accordingly
      const breakdownDimension = detectBreakdownDimension(query);
      const breakdownMap = new Map();
      
      allData.forEach(d => {
        const dateStr = new Date(d.date).toISOString().slice(0, 7);
        
        // Filter by time range
        if (interpretation.timeRange && !dateMatchesTimeRange(dateStr, interpretation.timeRange)) return;
        
        const hierarchy = skuMap.get(d.skuId);
        const revenue = Number(d.revenue) || 0;
        const cost = Number(d.cost) || 0;
        const profit = Number(d.profit) || 0;
        
        // Get the dimension value to group by
        let dimensionValue = "Unknown";
        if (breakdownDimension === "region") {
          dimensionValue = d.region || "Unknown";
        } else {
          dimensionValue = hierarchy?.category || "Unknown";
        }
        
        // Calculate the metric value
        let metricValue = 0;
        if (interpretation.metric === "profit") {
          metricValue = revenue > 0 ? (profit / revenue) * 100 : 0; // profit margin %
        } else if (interpretation.metric === "cost") {
          metricValue = Number(cost);
        } else {
          metricValue = Number(revenue);
        }
        
        if (!breakdownMap.has(dimensionValue)) {
          breakdownMap.set(dimensionValue, { name: dimensionValue, value: 0, count: 0 });
        }
        const entry = breakdownMap.get(dimensionValue)!;
        entry.value += metricValue;
        entry.count += 1;
      });
      
      // Calculate average for each dimension value
      const breakdownData = Array.from(breakdownMap.values()).map(item => ({
        name: item.name,
        value: interpretation.metric === "profit" && item.count > 0
          ? parseFloat((item.value / item.count).toFixed(2))
          : parseFloat((item.value / item.count).toFixed(2))
      }));
      
      let rootCauses = [];
      let explanationPrompt = `Explain the following data findings based on the user's query: "${query}".
      Metric: ${interpretation.metric}, TimeRange: ${interpretation.timeRange}, Intent: ${interpretation.intent}.`;
      
      if (interpretation.intent === 'root_cause') {
        // Get first and last month as strings (YYYY-MM format)
        const firstMonthStr = trendData[0]?.date;
        const lastMonthStr = trendData[trendData.length - 1]?.date;
        
        // Helper to get YYYY-MM from date
        const getDateMonth = (date: any) => {
          if (date instanceof Date) {
            return date.toISOString().slice(0, 7);
          }
          return String(date).slice(0, 7);
        };
        
        // Analyze category profit margin performance
        const categoryPerformance = new Map();
        allData.forEach(d => {
          const hierarchy = skuMap.get(d.skuId);
          const key = hierarchy?.category || "Unknown";
          const dateMonth = getDateMonth(d.date);
          const revenue = Number(d.revenue) || 0;
          const profit = Number(d.profit) || 0;
          const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
          
          if (!categoryPerformance.has(key)) {
            categoryPerformance.set(key, { first: 0, count1: 0, last: 0, count2: 0 });
          }
          const perf = categoryPerformance.get(key);
          
          if (dateMonth === firstMonthStr) {
            perf.first += profitMargin;
            perf.count1 += 1;
          }
          if (dateMonth === lastMonthStr) {
            perf.last += profitMargin;
            perf.count2 += 1;
          }
        });
        
        // Calculate average profit margin change for each category
        const productImpact = Array.from(categoryPerformance.entries())
          .map(([name, perf]) => {
            const firstMargin = perf.count1 > 0 ? perf.first / perf.count1 : 0;
            const lastMargin = perf.count2 > 0 ? perf.last / perf.count2 : 0;
            return {
              name,
              first: firstMargin,
              last: lastMargin,
              change: firstMargin > 0 ? ((firstMargin - lastMargin) / firstMargin) * 100 : 0
            };
          })
          .filter(p => p.first > 0 && Math.abs(p.change) > 0.5) // Only include meaningful changes
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        
        // Analyze region profit margin performance
        const regionPerformance = new Map();
        allData.forEach(d => {
          const key = d.region;
          const dateMonth = getDateMonth(d.date);
          const revenue = Number(d.revenue) || 0;
          const profit = Number(d.profit) || 0;
          const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
          
          if (!regionPerformance.has(key)) {
            regionPerformance.set(key, { first: 0, count1: 0, last: 0, count2: 0 });
          }
          const perf = regionPerformance.get(key);
          
          if (dateMonth === firstMonthStr) {
            perf.first += profitMargin;
            perf.count1 += 1;
          }
          if (dateMonth === lastMonthStr) {
            perf.last += profitMargin;
            perf.count2 += 1;
          }
        });
        
        // Calculate average profit margin change for regions
        const regionImpact = Array.from(regionPerformance.entries())
          .map(([name, perf]) => {
            const firstMargin = perf.count1 > 0 ? perf.first / perf.count1 : 0;
            const lastMargin = perf.count2 > 0 ? perf.last / perf.count2 : 0;
            return {
              name,
              first: firstMargin,
              last: lastMargin,
              change: firstMargin > 0 ? ((firstMargin - lastMargin) / firstMargin) * 100 : 0
            };
          })
          .filter(r => r.first > 0 && Math.abs(r.change) > 0.5) // Only include meaningful changes
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        
        // Build root causes array with top contributors - focusing on profit margin
        if (productImpact.length > 0) {
          rootCauses.push({
            dimension: "category",
            topContributor: productImpact[0].name,
            changePercentage: -Math.round(productImpact[0].change * 10) / 10
          });
        }
        if (regionImpact.length > 0) {
          rootCauses.push({
            dimension: "region",
            topContributor: regionImpact[0].name,
            changePercentage: -Math.round(regionImpact[0].change * 10) / 10
          });
        }
        
        const mainCause = rootCauses[0];
        if (mainCause) {
          explanationPrompt += `\nThe decline was primarily driven by ${mainCause.topContributor} which dropped by ${Math.abs(mainCause.changePercentage)}%.`;
          if (rootCauses[1]) {
            explanationPrompt += ` Additionally, the ${rootCauses[1].dimension} dimension shows ${rootCauses[1].topContributor} also contributed with a ${Math.abs(rootCauses[1].changePercentage)}% decline.`;
          }
          explanationPrompt += "\nProvide a brief summary with actionable recommendations to address this decline.";
        }
      }
      
      // Generate three separate AI descriptions
      const trendPrompt = `Based on this data: ${explanationPrompt}
      
      Provide a brief 1-2 sentence description of the overall trend (e.g., declining, growing, stable). Focus on what happened, not why.`;
      
      const rootCausesPrompt = `Based on this data: ${explanationPrompt}
      
      The top contributors to the change are: ${rootCauses.map(rc => `${rc.topContributor} (${rc.dimension}, ${Math.abs(rc.changePercentage)}%)`).join(', ')}.
      
      Provide a brief 2-3 sentence analysis of why these specific products and regions are underperforming. Include the percentage impacts.`;
      
      const suggestionsPrompt = `Based on this data: ${explanationPrompt}
      
      The decline was driven by: ${rootCauses.map(rc => rc.topContributor).join(', ')}.
      
      Provide 2-3 specific, actionable recommendations to address this decline. Be concrete and practical.`;

      const [trendResponse, causesResponse, suggestionsResponse] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [
            { role: "system", content: "You are a friendly business analyst. Be concise." },
            { role: "user", content: trendPrompt }
          ]
        }),
        openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [
            { role: "system", content: "You are a friendly business analyst. Be concise and include specific percentages." },
            { role: "user", content: rootCausesPrompt }
          ]
        }),
        openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [
            { role: "system", content: "You are a friendly business analyst. Provide actionable, specific recommendations." },
            { role: "user", content: suggestionsPrompt }
          ]
        })
      ]);

      const trendDescription = trendResponse.choices[0]?.message?.content || "Unable to generate trend description.";
      const rootCausesDescription = causesResponse.choices[0]?.message?.content || "Unable to generate root causes analysis.";
      const suggestions = suggestionsResponse.choices[0]?.message?.content || "Unable to generate suggestions.";

      // Build cross-table: category (rows) × region (columns)
      const crossMap = new Map<string, Map<string, { metricSum: number; revenueSum: number; count: number }>>();
      const regionSet = new Set<string>();

      allData.forEach(d => {
        const dateKey = new Date(d.date).toISOString().slice(0, 7);
        if (interpretation.timeRange && !dateMatchesTimeRange(dateKey, interpretation.timeRange)) return;

        const hierarchy = skuMap.get(d.skuId);
        const category = hierarchy?.category || "Unknown";
        const region = d.region || "Unknown";
        regionSet.add(region);

        if (!crossMap.has(category)) crossMap.set(category, new Map());
        const regionMap = crossMap.get(category)!;
        if (!regionMap.has(region)) regionMap.set(region, { metricSum: 0, revenueSum: 0, count: 0 });

        const entry = regionMap.get(region)!;
        const metricKey = interpretation.metric as "revenue" | "cost" | "profit";
        entry.metricSum += Number(d[metricKey]) || 0;
        entry.revenueSum += Number(d.revenue) || 0;
        entry.count += 1;
      });

      const regions = Array.from(regionSet).sort();
      const categories = Array.from(crossMap.keys()).sort();
      const isProfit = interpretation.metric === "profit";

      const crossTableRows = categories.map(category => {
        const regionMap = crossMap.get(category)!;
        const values: Record<string, number> = {};
        let rowTotal = 0;
        let rowRevenue = 0;

        regions.forEach(region => {
          const entry = regionMap.get(region);
          if (entry) {
            const val = isProfit
              ? (entry.revenueSum > 0 ? (entry.metricSum / entry.revenueSum) * 100 : 0)
              : entry.metricSum;
            values[region] = parseFloat(val.toFixed(isProfit ? 1 : 2));
            rowTotal += entry.metricSum;
            rowRevenue += entry.revenueSum;
          } else {
            values[region] = 0;
          }
        });

        const rowDisplayTotal = isProfit
          ? parseFloat((rowRevenue > 0 ? (rowTotal / rowRevenue) * 100 : 0).toFixed(1))
          : parseFloat(rowTotal.toFixed(2));

        return { category, values, rowTotal: rowDisplayTotal };
      });

      const columnTotals: Record<string, number> = {};
      const colRawMap = new Map<string, { metricSum: number; revenueSum: number }>();
      regions.forEach(region => {
        let metricSum = 0; let revenueSum = 0;
        crossMap.forEach(regionMap => {
          const e = regionMap.get(region);
          if (e) { metricSum += e.metricSum; revenueSum += e.revenueSum; }
        });
        colRawMap.set(region, { metricSum, revenueSum });
        columnTotals[region] = isProfit
          ? parseFloat((revenueSum > 0 ? (metricSum / revenueSum) * 100 : 0).toFixed(1))
          : parseFloat(metricSum.toFixed(2));
      });

      let grandTotalMetric = 0; let grandTotalRevenue = 0;
      colRawMap.forEach(v => { grandTotalMetric += v.metricSum; grandTotalRevenue += v.revenueSum; });
      const grandTotal = isProfit
        ? parseFloat((grandTotalRevenue > 0 ? (grandTotalMetric / grandTotalRevenue) * 100 : 0).toFixed(1))
        : parseFloat(grandTotalMetric.toFixed(2));

      const crossTableData = { regions, rows: crossTableRows, columnTotals, grandTotal };

      res.json({
        interpretation,
        trendData,
        crossTableData,
        breakdownData: !isHighestQuery ? breakdownData : [],
        rootCauses,
        trendDescription,
        rootCausesDescription,
        suggestions,
        topCategory: topCategory || null
      });
      
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      console.error(err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Drill-down endpoint: fetch metric data at a more granular hierarchy level
  app.post('/api/drilldown', async (req, res) => {
    try {
      const schema = z.object({
        metric: z.enum(["revenue", "cost", "profit"]),
        timeRange: z.string().optional(),
        parentDimension: z.enum(["category", "subcategory", "material", "region"]),
        parentValue: z.string(),
        drillLevel: z.enum(["category", "subcategory", "material", "sku", "region"]),
      });
      const input = schema.parse(req.body);
      
      const allData = await storage.getMetrics();
      
      // Build full hierarchy map
      const allSkuRows = await db.select().from(skus);
      type HierarchyEntry = { category: string; categoryId: number; subcategory: string; subcategoryId: number; material: string; materialId: number; sku: string; skuId: number };
      const hierarchyMap = new Map<number, HierarchyEntry>();
      
      for (const sku of allSkuRows) {
        const mat = await db.select().from(materialCodes).where(eq(materialCodes.id, sku.materialCodeId)).then(r => r[0]);
        if (!mat) continue;
        const subcat = await db.select().from(productSubcategories).where(eq(productSubcategories.id, mat.subcategoryId)).then(r => r[0]);
        if (!subcat) continue;
        const cat = await db.select().from(productCategories).where(eq(productCategories.id, subcat.categoryId)).then(r => r[0]);
        if (!cat) continue;
        
        hierarchyMap.set(sku.id, {
          category: cat.categoryName,
          categoryId: cat.id,
          subcategory: subcat.subcategoryName,
          subcategoryId: subcat.id,
          material: mat.materialCode,
          materialId: mat.id,
          sku: sku.sku,
          skuId: sku.id,
        });
      }
      
      // Helper to check time range match
      const matchesTimeRange = (dateStr: string, timeRange?: string): boolean => {
        if (!timeRange) return true;
        const year = dateStr.slice(0, 4);
        const month = dateStr.slice(5, 7);
        if (/^\d{4}$/.test(timeRange)) return year === timeRange;
        if (timeRange.toLowerCase().includes("q1")) return ["01","02","03"].includes(month);
        if (timeRange.toLowerCase().includes("q2")) return ["04","05","06"].includes(month);
        if (timeRange.toLowerCase().includes("q3")) return ["07","08","09"].includes(month);
        if (timeRange.toLowerCase().includes("q4")) return ["10","11","12"].includes(month);
        return true;
      };
      
      // Filter data by parentDimension/parentValue and timeRange
      const aggregateMap = new Map<string, { value: number; count: number }>();
      
      allData.forEach(d => {
        const dateStr = new Date(d.date).toISOString().slice(0, 7);
        if (!matchesTimeRange(dateStr, input.timeRange)) return;
        
        const h = hierarchyMap.get(d.skuId);
        if (!h) return;
        
        // Check if this record belongs to the parent dimension's value
        let matchesParent = false;
        if (input.parentDimension === "category") matchesParent = h.category === input.parentValue;
        else if (input.parentDimension === "subcategory") matchesParent = h.subcategory === input.parentValue;
        else if (input.parentDimension === "material") matchesParent = h.material === input.parentValue;
        else if (input.parentDimension === "region") matchesParent = d.region === input.parentValue;
        
        if (!matchesParent) return;
        
        // Get the drill-level key
        let drillKey = "Unknown";
        if (input.drillLevel === "category") drillKey = h.category;
        else if (input.drillLevel === "subcategory") drillKey = h.subcategory;
        else if (input.drillLevel === "material") drillKey = h.material;
        else if (input.drillLevel === "sku") drillKey = h.sku;
        else if (input.drillLevel === "region") drillKey = d.region;
        
        const revenue = Number(d.revenue) || 0;
        const cost = Number(d.cost) || 0;
        const profit = Number(d.profit) || 0;
        
        let metricValue = 0;
        if (input.metric === "profit") {
          metricValue = revenue > 0 ? (profit / revenue) * 100 : 0;
        } else if (input.metric === "cost") {
          metricValue = cost;
        } else {
          metricValue = revenue;
        }
        
        if (!aggregateMap.has(drillKey)) {
          aggregateMap.set(drillKey, { value: 0, count: 0 });
        }
        const entry = aggregateMap.get(drillKey)!;
        entry.value += metricValue;
        entry.count += 1;
      });
      
      const drillDownData = Array.from(aggregateMap.entries()).map(([name, { value, count }]) => ({
        name,
        value: input.metric === "profit"
          ? parseFloat((value / count).toFixed(2))
          : parseFloat((value / count).toFixed(2))
      })).sort((a, b) => b.value - a.value);
      
      res.json({ drillDownData });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error(err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
