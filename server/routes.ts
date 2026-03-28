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
      1. metric: The metric they are asking about. Use EXACTLY one of these four values:
         - 'revenue'       → if the query mentions revenue or sales
         - 'cost'          → if the query mentions cost or expenses
         - 'profit'        → if the query mentions profit (the dollar amount: revenue minus cost)
         - 'profit_margin' → ONLY if the query explicitly mentions margin, profit margin, margin %, or profitability ratio
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
        // Ensure null AI values never override defaults
        if (!interpretation.metric) interpretation.metric = "revenue";
        if (!interpretation.timeRange) interpretation.timeRange = "all time";
        if (!interpretation.intent) interpretation.intent = "trend";
      } catch (e) {
        console.error("Failed to parse intent", e);
      }
      
      // Normalize AI output: handle "profit margin" (spaced) → "profit_margin"
      const normalised = interpretation.metric.toLowerCase().replace(/\s+/g, "_");
      interpretation.metric = normalised;

      const allowedMetrics = ["revenue", "cost", "profit", "profit_margin"];
      if (!allowedMetrics.includes(interpretation.metric)) {
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
        const lower = timeRange.toLowerCase();

        // ── Relative time ranges (resolved against current date) ──────────────
        const now = new Date();
        const ny = now.getFullYear();
        const nm = now.getMonth(); // 0-based

        const isoKey = (y: number, m: number) => new Date(y, m, 1).toISOString().slice(0, 7);

        if (lower.includes("last month") || lower.includes("previous month")) {
          return dateStr === isoKey(ny, nm - 1);
        }
        if (lower.includes("this month") || lower.includes("current month")) {
          return dateStr === isoKey(ny, nm);
        }
        if (lower.includes("last quarter") || lower.includes("previous quarter")) {
          const curQStart = Math.floor(nm / 3) * 3;
          const lqStart = new Date(ny, curQStart - 3, 1);
          const lqKeys = [0, 1, 2].map(i => isoKey(lqStart.getFullYear(), lqStart.getMonth() + i));
          return lqKeys.includes(dateStr);
        }
        if (lower.includes("this quarter") || lower.includes("current quarter")) {
          const curQStart = Math.floor(nm / 3) * 3;
          const keys = [0, 1, 2].map(i => isoKey(ny, curQStart + i));
          return keys.includes(dateStr);
        }
        if (lower.includes("last year") || lower.includes("previous year")) {
          return year === String(ny - 1);
        }
        if (lower.includes("this year") || lower.includes("current year")) {
          return year === String(ny);
        }

        // ── Absolute time ranges ───────────────────────────────────────────────
        // Specific 4-digit year (e.g., "2024")
        if (/^\d{4}$/.test(timeRange)) return year === timeRange;

        // Year mentioned inline (e.g., "Q2 2024", "March 2024")
        const yearInRange = timeRange.match(/\b(20\d{2})\b/);
        const rangeYear = yearInRange ? yearInRange[1] : null;

        if (lower.includes("q1")) return ["01", "02", "03"].includes(month) && (!rangeYear || year === rangeYear);
        if (lower.includes("q2")) return ["04", "05", "06"].includes(month) && (!rangeYear || year === rangeYear);
        if (lower.includes("q3")) return ["07", "08", "09"].includes(month) && (!rangeYear || year === rangeYear);
        if (lower.includes("q4")) return ["10", "11", "12"].includes(month) && (!rangeYear || year === rangeYear);

        // Named months — respect year qualifier if present
        const matchMonth = (m: string) => month === m && (!rangeYear || year === rangeYear);
        if (lower.includes("january") || lower.includes("jan")) return matchMonth("01");
        if (lower.includes("february") || lower.includes("feb")) return matchMonth("02");
        if (lower.includes("march") || lower.includes("mar")) return matchMonth("03");
        if (lower.includes("april") || lower.includes("apr")) return matchMonth("04");
        if (lower.includes("may")) return matchMonth("05");
        if (lower.includes("june") || lower.includes("jun")) return matchMonth("06");
        if (lower.includes("july") || lower.includes("jul")) return matchMonth("07");
        if (lower.includes("august") || lower.includes("aug")) return matchMonth("08");
        if (lower.includes("september") || lower.includes("sep")) return matchMonth("09");
        if (lower.includes("october") || lower.includes("oct")) return matchMonth("10");
        if (lower.includes("november") || lower.includes("nov")) return matchMonth("11");
        if (lower.includes("december") || lower.includes("dec")) return matchMonth("12");

        // Year-only mentioned without isolated match (e.g. "year 2025")
        if (rangeYear) return year === rangeYear;

        return true; // Default: include all if no pattern matched
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
      
      // Find the top category for any metric when the query asks "highest" / "top"
      if (isHighestQuery) {
        if (interpretation.metric === "profit_margin") {
          // For profit margin %: use weighted average (profitSum / revenueSum)
          const marginByCategory = new Map<string, { profitSum: number; revenueSum: number }>();
          allData.forEach(d => {
            const dateStr = new Date(d.date).toISOString().slice(0, 7);
            if (!dateMatchesTimeRange(dateStr, interpretation.timeRange)) return;
            const hierarchy = skuMap.get(d.skuId);
            const cat = hierarchy?.category || "Unknown";
            const rev = Number(d.revenue) || 0;
            const pft = Number(d.profit) || 0;
            if (!marginByCategory.has(cat)) marginByCategory.set(cat, { profitSum: 0, revenueSum: 0 });
            const e = marginByCategory.get(cat)!;
            e.profitSum += pft;
            e.revenueSum += rev;
          });
          let maxMargin = -1;
          for (const [cat, data] of marginByCategory) {
            const margin = data.revenueSum > 0 ? (data.profitSum / data.revenueSum) * 100 : 0;
            if (margin > maxMargin) { maxMargin = margin; topCategory = cat; }
          }
        } else {
          // For revenue / cost: highest total sum across the time range
          const totalByCategory = new Map<string, number>();
          allData.forEach(d => {
            const dateStr = new Date(d.date).toISOString().slice(0, 7);
            if (!dateMatchesTimeRange(dateStr, interpretation.timeRange)) return;
            const hierarchy = skuMap.get(d.skuId);
            const cat = hierarchy?.category || "Unknown";
            const val = Number(d[interpretation.metric as keyof typeof d]) || 0;
            totalByCategory.set(cat, (totalByCategory.get(cat) || 0) + val);
          });
          let maxVal = -1;
          for (const [cat, total] of totalByCategory) {
            if (total > maxVal) { maxVal = total; topCategory = cat; }
          }
        }
      }
      
      // For highest queries, aggregate trend data by category (multi-series)
      // Otherwise, aggregate as a single trend line
      let trendData: any[] = [];
      
      if (isHighestQuery) {
        // Build multi-series trend data by category for any metric
        const isProfitMargin = interpretation.metric === "profit_margin";
        const categoryTrendMap = new Map<string, Map<string, { value: number; count: number }>>();

        allData.forEach(d => {
          const dateKey = new Date(d.date).toISOString().slice(0, 7);
          if (interpretation.timeRange && !dateMatchesTimeRange(dateKey, interpretation.timeRange)) return;

          const hierarchy = skuMap.get(d.skuId);
          const categoryName = hierarchy?.category || "Unknown";
          const revenue = Number(d.revenue) || 0;
          const profit = Number(d.profit) || 0;
          const metricValue = isProfitMargin
            ? (revenue > 0 ? (profit / revenue) * 100 : 0)
            : (interpretation.metric === "profit"
                ? profit
                : Number(d[interpretation.metric as keyof typeof d]) || 0);

          if (!categoryTrendMap.has(categoryName)) categoryTrendMap.set(categoryName, new Map());
          const catMap = categoryTrendMap.get(categoryName)!;
          if (!catMap.has(dateKey)) catMap.set(dateKey, { value: 0, count: 0 });
          const entry = catMap.get(dateKey)!;
          entry.value += metricValue;
          entry.count += 1;
        });

        const dateSet = new Set<string>();
        categoryTrendMap.forEach(catMap => catMap.forEach((_, dk) => dateSet.add(dk)));

        const dates = Array.from(dateSet).sort();
        trendData = dates.map(dateKey => {
          const row: any = { date: dateKey };
          categoryTrendMap.forEach((catMap, categoryName) => {
            const entry = catMap.get(dateKey);
            // profit_margin → average; revenue/cost/profit → running sum
            row[categoryName] = entry
              ? isProfitMargin
                ? parseFloat((entry.value / entry.count).toFixed(2))
                : parseFloat(entry.value.toFixed(2))
              : 0;
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
          
          if (interpretation.metric === "profit_margin") {
            const revenue = Number(d.revenue) || 0;
            const profit = Number(d.profit) || 0;
            entry.value += revenue > 0 ? (profit / revenue) * 100 : 0;
          } else if (interpretation.metric === "profit") {
            entry.value += Number(d.profit) || 0;
          } else {
            entry.value += Number(d[interpretation.metric as keyof typeof d] || 0);
          }
          entry.count += 1;
        });
        
        // Average profit_margin values; sum everything else
        trendData = Array.from(trendMap.values()).map(item => ({
          date: item.date,
          value: interpretation.metric === "profit_margin" && item.count > 0 
            ? parseFloat((item.value / item.count).toFixed(2))
            : item.value
        })).sort((a, b) => a.date.localeCompare(b.date));
      }
      
      // Detect breakdown dimension and aggregate data accordingly
      const breakdownDimension = detectBreakdownDimension(query);
      const breakdownMap = new Map<string, { name: string; metricSum: number; revenueSum: number }>();

      allData.forEach(d => {
        const dateStr = new Date(d.date).toISOString().slice(0, 7);

        // Filter by time range
        if (interpretation.timeRange && !dateMatchesTimeRange(dateStr, interpretation.timeRange)) return;

        const hierarchy = skuMap.get(d.skuId);
        const revenue = Number(d.revenue) || 0;
        const cost = Number(d.cost) || 0;
        const profit = Number(d.profit) || 0;

        const dimensionValue = breakdownDimension === "region"
          ? (d.region || "Unknown")
          : (hierarchy?.category || "Unknown");

        if (!breakdownMap.has(dimensionValue)) {
          breakdownMap.set(dimensionValue, { name: dimensionValue, metricSum: 0, revenueSum: 0 });
        }
        const entry = breakdownMap.get(dimensionValue)!;
        // Accumulate raw metric sum and revenue sum for weighted profit margin later
        entry.metricSum += interpretation.metric === "profit_margin" ? profit
          : interpretation.metric === "profit" ? profit
          : interpretation.metric === "cost" ? cost
          : revenue;
        entry.revenueSum += revenue;
      });

      // For revenue/cost/profit: return total. For profit_margin: weighted average (profitSum / revenueSum).
      const breakdownData = Array.from(breakdownMap.values()).map(item => ({
        name: item.name,
        value: interpretation.metric === "profit_margin"
          ? parseFloat((item.revenueSum > 0 ? (item.metricSum / item.revenueSum) * 100 : 0).toFixed(2))
          : parseFloat(item.metricSum.toFixed(2)),
      }));
      
      let rootCauses = [];
      let explanationPrompt = `Explain the following data findings based on the user's query: "${query}".
      Metric: ${interpretation.metric}, TimeRange: ${interpretation.timeRange}, Intent: ${interpretation.intent}.`;
      
      if (interpretation.intent === 'root_cause') {
        // Compare current period vs previous period using the same resolution
        // used for the causal cross table — works for "last month", "last quarter", etc.
        const { currentKeys: rcCurKeys, previousKeys: rcPrevKeys } =
          resolveCausalPeriods(interpretation.timeRange);

        // profit_margin has no DB column — map it to "profit" and compute margin in rcCalc
        const rcDbCol = (interpretation.metric === "profit" || interpretation.metric === "profit_margin")
          ? "profit" : interpretation.metric as "revenue" | "cost";
        const rcIsMargin = interpretation.metric === "profit_margin";

        // Aggregate by category and region for both periods
        const rcCatCur  = new Map<string, { m: number; r: number }>();
        const rcCatPrev = new Map<string, { m: number; r: number }>();
        const rcRegCur  = new Map<string, { m: number; r: number }>();
        const rcRegPrev = new Map<string, { m: number; r: number }>();

        allData.forEach(d => {
          const dk = new Date(d.date).toISOString().slice(0, 7);
          const isCur  = rcCurKeys.includes(dk);
          const isPrev = rcPrevKeys.includes(dk);
          if (!isCur && !isPrev) return;

          const cat = skuMap.get(d.skuId)?.category || "Unknown";
          const reg = d.region || "Unknown";
          const rev = Number(d.revenue) || 0;
          const mv  = Number(d[rcDbCol as keyof typeof d]) || 0;

          const cm = isCur ? rcCatCur : rcCatPrev;
          if (!cm.has(cat)) cm.set(cat, { m: 0, r: 0 });
          cm.get(cat)!.m += mv; cm.get(cat)!.r += rev;

          const rm = isCur ? rcRegCur : rcRegPrev;
          if (!rm.has(reg)) rm.set(reg, { m: 0, r: 0 });
          rm.get(reg)!.m += mv; rm.get(reg)!.r += rev;
        });

        const rcCalc = (e: { m: number; r: number }) =>
          rcIsMargin ? (e.r > 0 ? (e.m / e.r) * 100 : 0) : e.m;

        const rcPctChange = (cur: number, prev: number) =>
          prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0;

        const productImpact = Array.from(rcCatCur.keys())
          .map(name => {
            const curVal  = rcCalc(rcCatCur.get(name)!);
            const prevEntry = rcCatPrev.get(name);
            const prevVal = prevEntry ? rcCalc(prevEntry) : 0;
            return { name, curVal, prevVal, change: rcPctChange(curVal, prevVal) };
          })
          .filter(p => Math.abs(p.change) > 0.1)
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

        const regionImpact = Array.from(rcRegCur.keys())
          .map(name => {
            const curVal  = rcCalc(rcRegCur.get(name)!);
            const prevEntry = rcRegPrev.get(name);
            const prevVal = prevEntry ? rcCalc(prevEntry) : 0;
            return { name, curVal, prevVal, change: rcPctChange(curVal, prevVal) };
          })
          .filter(r => Math.abs(r.change) > 0.1)
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

        if (productImpact.length > 0) {
          rootCauses.push({
            dimension: "category",
            topContributor: productImpact[0].name,
            changePercentage: parseFloat(productImpact[0].change.toFixed(1)),
          });
        }
        if (regionImpact.length > 0) {
          rootCauses.push({
            dimension: "region",
            topContributor: regionImpact[0].name,
            changePercentage: parseFloat(regionImpact[0].change.toFixed(1)),
          });
        }
      }
      
      // ── Build a compact cross-table snapshot for the AI prompts ─────────────
      // We compute category × region totals for the query period (and previous
      // period for causal queries) so the AI can reference real numbers.
      const fmt$ = (v: number) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M`
                                  : v >= 1_000 ? `$${(v/1_000).toFixed(1)}k`
                                  : `$${v.toFixed(0)}`;
      const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

      // Aggregate category totals for current period
      const ctCurrent = new Map<string, { m: number; r: number }>();
      const ctPrev    = new Map<string, { m: number; r: number }>();
      const ctRegCur  = new Map<string, { m: number; r: number }>();
      const ctRegPrev = new Map<string, { m: number; r: number }>();
      // profit_margin has no DB column — read from "profit", compute margin in calcDisplay
      const mk2 = (interpretation.metric === "profit" || interpretation.metric === "profit_margin")
        ? "profit" : interpretation.metric as "revenue" | "cost";
      const isP2 = interpretation.metric === "profit_margin";

      // For causal: use the already-resolved period keys
      let curKeys2: string[] = [];
      let prevKeys2: string[] = [];
      let curLabel2 = "";
      let prevLabel2 = "";

      if (interpretation.intent === "root_cause") {
        const resolved = resolveCausalPeriods(interpretation.timeRange);
        curKeys2 = resolved.currentKeys;
        prevKeys2 = resolved.previousKeys;
        curLabel2 = resolved.currentLabel;
        prevLabel2 = resolved.previousLabel;
      }

      allData.forEach(d => {
        const dk = new Date(d.date).toISOString().slice(0, 7);
        const cat = skuMap.get(d.skuId)?.category || "Unknown";
        const reg = d.region || "Unknown";
        const rev = Number(d.revenue) || 0;
        const metricRaw = Number(d[mk2]) || 0;

        if (interpretation.intent === "root_cause") {
          const isCur  = curKeys2.includes(dk);
          const isPrev = prevKeys2.includes(dk);
          if (isCur) {
            if (!ctCurrent.has(cat)) ctCurrent.set(cat, { m: 0, r: 0 });
            const e = ctCurrent.get(cat)!; e.m += metricRaw; e.r += rev;
            if (!ctRegCur.has(reg)) ctRegCur.set(reg, { m: 0, r: 0 });
            const er = ctRegCur.get(reg)!; er.m += metricRaw; er.r += rev;
          }
          if (isPrev) {
            if (!ctPrev.has(cat)) ctPrev.set(cat, { m: 0, r: 0 });
            const e = ctPrev.get(cat)!; e.m += metricRaw; e.r += rev;
            if (!ctRegPrev.has(reg)) ctRegPrev.set(reg, { m: 0, r: 0 });
            const er = ctRegPrev.get(reg)!; er.m += metricRaw; er.r += rev;
          }
        } else {
          if (interpretation.timeRange && !dateMatchesTimeRange(dk, interpretation.timeRange)) return;
          if (!ctCurrent.has(cat)) ctCurrent.set(cat, { m: 0, r: 0 });
          const e = ctCurrent.get(cat)!; e.m += metricRaw; e.r += rev;
          if (!ctRegCur.has(reg)) ctRegCur.set(reg, { m: 0, r: 0 });
          const er = ctRegCur.get(reg)!; er.m += metricRaw; er.r += rev;
        }
      });

      const calcDisplay = (e: { m: number; r: number }) =>
        isP2 ? e.r > 0 ? (e.m / e.r) * 100 : 0 : e.m;

      let crossTableSummary = "";
      if (interpretation.intent === "root_cause" && ctCurrent.size > 0) {
        const catLines = Array.from(ctCurrent.keys()).sort().map(cat => {
          const cur = ctCurrent.get(cat)!;
          const prev = ctPrev.get(cat);
          const curVal = calcDisplay(cur);
          const prevVal = prev ? calcDisplay(prev) : null;
          const chg = prevVal && prevVal !== 0 ? ((curVal - prevVal) / Math.abs(prevVal)) * 100 : null;
          const curStr = isP2 ? `${curVal.toFixed(1)}%` : fmt$(curVal);
          const prevStr = prev ? (isP2 ? `${calcDisplay(prev).toFixed(1)}%` : fmt$(calcDisplay(prev))) : "–";
          return `  • ${cat}: ${curStr} vs ${prevStr}${chg !== null ? ` (${fmtPct(chg)})` : ""}`;
        }).join("\n");

        const regLines = Array.from(ctRegCur.keys()).sort().map(reg => {
          const cur = ctRegCur.get(reg)!;
          const prev = ctRegPrev.get(reg);
          const curVal = calcDisplay(cur);
          const prevVal = prev ? calcDisplay(prev) : null;
          const chg = prevVal && prevVal !== 0 ? ((curVal - prevVal) / Math.abs(prevVal)) * 100 : null;
          const curStr = isP2 ? `${curVal.toFixed(1)}%` : fmt$(curVal);
          const prevStr = prev ? (isP2 ? `${calcDisplay(prev).toFixed(1)}%` : fmt$(calcDisplay(prev))) : "–";
          return `  • ${reg}: ${curStr} vs ${prevStr}${chg !== null ? ` (${fmtPct(chg)})` : ""}`;
        }).join("\n");

        crossTableSummary = `\nPeriod comparison (${curLabel2} vs ${prevLabel2}):\nBy product category:\n${catLines}\nBy region:\n${regLines}`;
      } else if (ctCurrent.size > 0) {
        const catLines = Array.from(ctCurrent.keys()).sort().map(cat => {
          const val = calcDisplay(ctCurrent.get(cat)!);
          return `  • ${cat}: ${isP2 ? `${val.toFixed(1)}%` : fmt$(val)}`;
        }).join("\n");
        crossTableSummary = `\nBreakdown by product category:\n${catLines}`;
      }

      // ── Prompts ─────────────────────────────────────────────────────────────
      const analysisSystemPrompt = "You are a concise business analyst. Reply in plain English. No bullet intro headers, no markdown. Use numbers from the data.";

      const trendPrompt = `Query: "${query}"
Metric: ${interpretation.metric}, Period: ${interpretation.timeRange}.${crossTableSummary}

Write ONE short sentence (max 25 words) summarising what happened to ${interpretation.metric} in this period. State the direction and rough magnitude. No recommendations.`;

      const suggestionsPrompt = `Query: "${query}"
Metric: ${interpretation.metric}, Period: ${interpretation.timeRange}.${crossTableSummary}
Top contributors: ${rootCauses.map(rc => rc.topContributor).join(", ") || "all categories"}.

Give exactly 3 bullet-point recommendations, each starting with "• ". Max 20 words per bullet. Make each recommendation specific and actionable based on the data above.`;

      // Trend and suggestions run in parallel — both are reliable
      const [trendResponse, suggestionsResponse] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [
            { role: "system", content: analysisSystemPrompt },
            { role: "user", content: trendPrompt }
          ],
          max_completion_tokens: 80,
        }),
        openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [
            { role: "system", content: analysisSystemPrompt },
            { role: "user", content: suggestionsPrompt }
          ],
          max_completion_tokens: 150,
        })
      ]);

      const trendDescription = trendResponse.choices[0]?.message?.content?.trim() || "Unable to generate trend description.";
      const suggestions = suggestionsResponse.choices[0]?.message?.content?.trim() || "Unable to generate suggestions.";

      // Root causes description: only generated when root causes exist.
      // Try AI first; fall back to a deterministic description from structured data.
      let rootCausesDescription = "";
      if (rootCauses.length > 0) {
        const rcPrompt = `Query: "${query}"
Metric: ${interpretation.metric}, Period: ${interpretation.timeRange}.${crossTableSummary}
Top contributors by change: ${rootCauses.map(rc => `${rc.topContributor} (${rc.dimension}: ${rc.changePercentage >= 0 ? "+" : ""}${rc.changePercentage}%)`).join("; ")}.

Write 2–3 short sentences identifying the main drivers of this change. Reference specific dollar amounts or percentages from the data above.`;

        try {
          const causesResponse = await openai.chat.completions.create({
            model: "gpt-5.1",
            messages: [
              { role: "system", content: analysisSystemPrompt },
              { role: "user", content: rcPrompt }
            ],
            max_completion_tokens: 200,
          });
          rootCausesDescription = causesResponse.choices[0]?.message?.content?.trim() || "";
        } catch (_) {
          // Handled by fallback below
        }

        // Deterministic fallback: build from the structured data we already computed
        if (!rootCausesDescription) {
          const parts: string[] = [];
          for (const rc of rootCauses) {
            const sign = rc.changePercentage >= 0 ? "+" : "";
            if (rc.dimension === "category") {
              const cur = ctCurrent.get(rc.topContributor);
              const prev = ctPrev.get(rc.topContributor);
              if (cur && prev) {
                const curV = calcDisplay(cur), prevV = calcDisplay(prev);
                const curStr = isP2 ? `${curV.toFixed(1)}%` : fmt$(curV);
                const prevStr = isP2 ? `${prevV.toFixed(1)}%` : fmt$(prevV);
                parts.push(`${rc.topContributor} had the largest category impact, moving from ${prevStr} to ${curStr} (${sign}${rc.changePercentage}%)`);
              } else {
                parts.push(`${rc.topContributor} (category) changed by ${sign}${rc.changePercentage}%`);
              }
            } else {
              const cur = ctRegCur.get(rc.topContributor);
              const prev = ctRegPrev.get(rc.topContributor);
              if (cur && prev) {
                const curV = calcDisplay(cur), prevV = calcDisplay(prev);
                const curStr = isP2 ? `${curV.toFixed(1)}%` : fmt$(curV);
                const prevStr = isP2 ? `${prevV.toFixed(1)}%` : fmt$(prevV);
                parts.push(`${rc.topContributor} was the most-impacted region, moving from ${prevStr} to ${curStr} (${sign}${rc.changePercentage}%)`);
              } else {
                parts.push(`${rc.topContributor} (region) changed by ${sign}${rc.changePercentage}%`);
              }
            }
          }
          rootCausesDescription = parts.join(". ") + ".";
        }
      }

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
        const metricKey = (interpretation.metric === "profit" || interpretation.metric === "profit_margin")
          ? "profit" : interpretation.metric as "revenue" | "cost";
        entry.metricSum += Number(d[metricKey]) || 0;
        entry.revenueSum += Number(d.revenue) || 0;
        entry.count += 1;
      });

      const regions = Array.from(regionSet).sort();
      const categories = Array.from(crossMap.keys()).sort();
      const isProfit = interpretation.metric === "profit_margin";

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

      // ── Causal Time-Comparison Cross Table ───────────────────────────────────
      // For root_cause queries: build a category × region table for BOTH the
      // query period AND the immediately preceding period of the same granularity.

      function resolveCausalPeriods(timeRange: string) {
        const lower = (timeRange || '').toLowerCase();
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-based (March 2026 → 2)

        const isoKey = (d: Date) => d.toISOString().slice(0, 7);
        const label = (key: string) => {
          const [y, m] = key.split('-').map(Number);
          return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
        };

        // "last month"
        if (lower.includes('last month') || lower.includes('previous month')) {
          const cur = new Date(year, month - 1, 1);
          const prev = new Date(year, month - 2, 1);
          const ck = isoKey(cur); const pk = isoKey(prev);
          return { currentKeys: [ck], previousKeys: [pk], currentLabel: label(ck), previousLabel: label(pk) };
        }

        // "last quarter"
        if (lower.includes('last quarter') || lower.includes('previous quarter')) {
          const curQStartMonth = Math.floor(month / 3) * 3;
          const lqStart = new Date(year, curQStartMonth - 3, 1);
          const pqStart = new Date(year, curQStartMonth - 6, 1);
          const qKeys = (start: Date) => [0, 1, 2].map(i => isoKey(new Date(start.getFullYear(), start.getMonth() + i, 1)));
          const qLabel = (keys: string[]) => {
            const d = new Date(keys[0] + '-01');
            return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
          };
          const ck = qKeys(lqStart); const pk = qKeys(pqStart);
          return { currentKeys: ck, previousKeys: pk, currentLabel: qLabel(ck), previousLabel: qLabel(pk) };
        }

        // "last year"
        if (lower.includes('last year') || lower.includes('previous year')) {
          const yy = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
          return { currentKeys: yy(year - 1), previousKeys: yy(year - 2), currentLabel: String(year - 1), previousLabel: String(year - 2) };
        }

        // Specific 4-digit year e.g. "2025"
        const ym = lower.match(/\b(20\d{2})\b/);
        if (ym) {
          const sy = parseInt(ym[1]);
          const yy = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
          return { currentKeys: yy(sy), previousKeys: yy(sy - 1), currentLabel: String(sy), previousLabel: String(sy - 1) };
        }

        // Default: last 3 months vs 3 months before
        const last3 = [2, 1, 0].map(i => isoKey(new Date(year, month - 1 - i, 1)));
        const prev3 = [5, 4, 3].map(i => isoKey(new Date(year, month - 1 - i, 1)));
        return {
          currentKeys: last3, previousKeys: prev3,
          currentLabel: `${label(last3[0])} – ${label(last3[2])}`,
          previousLabel: `${label(prev3[0])} – ${label(prev3[2])}`,
        };
      }

      let causalCrossTableData: any = null;

      if (interpretation.intent === 'root_cause') {
        const { currentKeys, previousKeys, currentLabel, previousLabel } =
          resolveCausalPeriods(interpretation.timeRange);

        type PE = { metricSum: number; revenueSum: number };
        const causalMap = new Map<string, { cur: Map<string, PE>; prev: Map<string, PE> }>();
        const causalRegions = new Set<string>();
        // profit_margin has no DB column — read from "profit", display as margin in calcVal
        const mk = (interpretation.metric === 'profit' || interpretation.metric === 'profit_margin')
          ? 'profit' : interpretation.metric as 'revenue' | 'cost';
        const causalIsMargin = interpretation.metric === 'profit_margin';

        allData.forEach(d => {
          const dk = new Date(d.date).toISOString().slice(0, 7);
          const isCur = currentKeys.includes(dk);
          const isPrev = previousKeys.includes(dk);
          if (!isCur && !isPrev) return;

          const cat = skuMap.get(d.skuId)?.category || 'Unknown';
          const reg = d.region || 'Unknown';
          causalRegions.add(reg);

          if (!causalMap.has(cat)) causalMap.set(cat, { cur: new Map(), prev: new Map() });
          const tm = isCur ? causalMap.get(cat)!.cur : causalMap.get(cat)!.prev;
          if (!tm.has(reg)) tm.set(reg, { metricSum: 0, revenueSum: 0 });
          const e = tm.get(reg)!;
          e.metricSum += Number(d[mk]) || 0;
          e.revenueSum += Number(d.revenue) || 0;
        });

        const calcVal = (e: PE | undefined) => {
          if (!e) return 0;
          return causalIsMargin ? (e.revenueSum > 0 ? (e.metricSum / e.revenueSum) * 100 : 0) : e.metricSum;
        };
        const fmt = (v: number) => parseFloat(v.toFixed(causalIsMargin ? 1 : 2));

        const cRegions = Array.from(causalRegions).sort();
        const cCats = Array.from(causalMap.keys()).sort();

        const cRows = cCats.map(cat => {
          const { cur, prev } = causalMap.get(cat)!;
          const cv: Record<string, number> = {}; const pv: Record<string, number> = {};
          let cm = 0, cr = 0, pm = 0, pr = 0;
          cRegions.forEach(r => {
            const ce = cur.get(r); const pe = prev.get(r);
            cv[r] = fmt(calcVal(ce)); pv[r] = fmt(calcVal(pe));
            if (ce) { cm += ce.metricSum; cr += ce.revenueSum; }
            if (pe) { pm += pe.metricSum; pr += pe.revenueSum; }
          });
          const crt = fmt(causalIsMargin ? (cr > 0 ? (cm / cr) * 100 : 0) : cm);
          const prt = fmt(causalIsMargin ? (pr > 0 ? (pm / pr) * 100 : 0) : pm);
          return { category: cat, currentValues: cv, previousValues: pv, currentRowTotal: crt, previousRowTotal: prt };
        });

        const curColTotals: Record<string, number> = {};
        const prevColTotals: Record<string, number> = {};
        let cgm = 0, cgr = 0, pgm = 0, pgr = 0;
        cRegions.forEach(r => {
          let cm = 0, cr = 0, pm = 0, pr = 0;
          causalMap.forEach(({ cur, prev }) => {
            const ce = cur.get(r); const pe = prev.get(r);
            if (ce) { cm += ce.metricSum; cr += ce.revenueSum; }
            if (pe) { pm += pe.metricSum; pr += pe.revenueSum; }
          });
          curColTotals[r] = fmt(causalIsMargin ? (cr > 0 ? (cm / cr) * 100 : 0) : cm);
          prevColTotals[r] = fmt(causalIsMargin ? (pr > 0 ? (pm / pr) * 100 : 0) : pm);
          cgm += cm; cgr += cr; pgm += pm; pgr += pr;
        });

        const curGrandTotal = fmt(causalIsMargin ? (cgr > 0 ? (cgm / cgr) * 100 : 0) : cgm);
        const prevGrandTotal = fmt(causalIsMargin ? (pgr > 0 ? (pgm / pgr) * 100 : 0) : pgm);

        causalCrossTableData = {
          currentLabel, previousLabel,
          regions: cRegions,
          rows: cRows,
          currentColumnTotals: curColTotals,
          previousColumnTotals: prevColTotals,
          currentGrandTotal: curGrandTotal, prevGrandTotal,
        };
      }

      res.json({
        interpretation,
        trendData,
        crossTableData,
        causalCrossTableData,
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
        metric: z.enum(["revenue", "cost", "profit", "profit_margin"]),
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
      
      // Helper to check time range match — mirrors the main dateMatchesTimeRange logic
      const matchesTimeRange = (dateStr: string, timeRange?: string): boolean => {
        if (!timeRange) return true;
        const year = dateStr.slice(0, 4);
        const month = dateStr.slice(5, 7);
        const lower = timeRange.toLowerCase();
        const now = new Date();
        const ny = now.getFullYear();
        const nm = now.getMonth();
        const isoKey = (y: number, m: number) => new Date(y, m, 1).toISOString().slice(0, 7);

        if (lower.includes("last month") || lower.includes("previous month")) return dateStr === isoKey(ny, nm - 1);
        if (lower.includes("this month") || lower.includes("current month")) return dateStr === isoKey(ny, nm);
        if (lower.includes("last quarter") || lower.includes("previous quarter")) {
          const lqStart = new Date(ny, Math.floor(nm / 3) * 3 - 3, 1);
          return [0, 1, 2].map(i => isoKey(lqStart.getFullYear(), lqStart.getMonth() + i)).includes(dateStr);
        }
        if (lower.includes("this quarter") || lower.includes("current quarter")) {
          const cqStart = Math.floor(nm / 3) * 3;
          return [0, 1, 2].map(i => isoKey(ny, cqStart + i)).includes(dateStr);
        }
        if (lower.includes("last year") || lower.includes("previous year")) return year === String(ny - 1);
        if (lower.includes("this year") || lower.includes("current year")) return year === String(ny);
        if (/^\d{4}$/.test(timeRange)) return year === timeRange;
        const yearInRange = timeRange.match(/\b(20\d{2})\b/);
        const ry = yearInRange ? yearInRange[1] : null;
        if (lower.includes("q1")) return ["01","02","03"].includes(month) && (!ry || year === ry);
        if (lower.includes("q2")) return ["04","05","06"].includes(month) && (!ry || year === ry);
        if (lower.includes("q3")) return ["07","08","09"].includes(month) && (!ry || year === ry);
        if (lower.includes("q4")) return ["10","11","12"].includes(month) && (!ry || year === ry);
        const mm = (m: string) => month === m && (!ry || year === ry);
        if (lower.includes("january") || lower.includes("jan")) return mm("01");
        if (lower.includes("february") || lower.includes("feb")) return mm("02");
        if (lower.includes("march") || lower.includes("mar")) return mm("03");
        if (lower.includes("april") || lower.includes("apr")) return mm("04");
        if (lower.includes("may")) return mm("05");
        if (lower.includes("june") || lower.includes("jun")) return mm("06");
        if (lower.includes("july") || lower.includes("jul")) return mm("07");
        if (lower.includes("august") || lower.includes("aug")) return mm("08");
        if (lower.includes("september") || lower.includes("sep")) return mm("09");
        if (lower.includes("october") || lower.includes("oct")) return mm("10");
        if (lower.includes("november") || lower.includes("nov")) return mm("11");
        if (lower.includes("december") || lower.includes("dec")) return mm("12");
        if (ry) return year === ry;
        return true;
      };

      // Aggregate by drill-level key; track profit + revenue separately for weighted margin
      const aggregateMap = new Map<string, { metricSum: number; revenueSum: number }>();

      allData.forEach(d => {
        const dateStr = new Date(d.date).toISOString().slice(0, 7);
        if (!matchesTimeRange(dateStr, input.timeRange)) return;

        const h = hierarchyMap.get(d.skuId);
        if (!h) return;

        let matchesParent = false;
        if (input.parentDimension === "category") matchesParent = h.category === input.parentValue;
        else if (input.parentDimension === "subcategory") matchesParent = h.subcategory === input.parentValue;
        else if (input.parentDimension === "material") matchesParent = h.material === input.parentValue;
        else if (input.parentDimension === "region") matchesParent = d.region === input.parentValue;
        if (!matchesParent) return;

        let drillKey = "Unknown";
        if (input.drillLevel === "category") drillKey = h.category;
        else if (input.drillLevel === "subcategory") drillKey = h.subcategory;
        else if (input.drillLevel === "material") drillKey = h.material;
        else if (input.drillLevel === "sku") drillKey = h.sku;
        else if (input.drillLevel === "region") drillKey = d.region;

        const revenue = Number(d.revenue) || 0;
        const cost = Number(d.cost) || 0;
        const profit = Number(d.profit) || 0;

        if (!aggregateMap.has(drillKey)) aggregateMap.set(drillKey, { metricSum: 0, revenueSum: 0 });
        const entry = aggregateMap.get(drillKey)!;
        entry.metricSum += (input.metric === "profit" || input.metric === "profit_margin") ? profit : input.metric === "cost" ? cost : revenue;
        entry.revenueSum += revenue;
      });

      // Revenue/cost/profit: total sum. Profit margin: weighted average.
      const drillDownData = Array.from(aggregateMap.entries()).map(([name, { metricSum, revenueSum }]) => ({
        name,
        value: input.metric === "profit_margin"
          ? parseFloat((revenueSum > 0 ? (metricSum / revenueSum) * 100 : 0).toFixed(2))
          : parseFloat(metricSum.toFixed(2)),
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
