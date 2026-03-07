import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { openai } from "./replit_integrations/image/client"; // Reusing the OpenAI client from the AI integrations module
import { performanceMetrics } from "@shared/schema";

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
      
      // Aggregate by month for trend
      const trendMap = new Map();
      allData.forEach(d => {
        const dateKey = new Date(d.date).toISOString().slice(0, 7); // YYYY-MM
        if (!trendMap.has(dateKey)) {
          trendMap.set(dateKey, { date: dateKey, value: 0 });
        }
        trendMap.get(dateKey).value += Number(d[interpretation.metric as keyof typeof d] || 0);
      });
      const trendData = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      
      // Aggregate by product for breakdown
      const breakdownMap = new Map();
      allData.forEach(d => {
        if (!breakdownMap.has(d.product)) {
          breakdownMap.set(d.product, { name: d.product, value: 0 });
        }
        breakdownMap.get(d.product).value += Number(d[interpretation.metric as keyof typeof d] || 0);
      });
      const breakdownData = Array.from(breakdownMap.values());
      
      let rootCauses = [];
      let explanationPrompt = `Explain the following data findings based on the user's query: "${query}".
      Metric: ${interpretation.metric}, TimeRange: ${interpretation.timeRange}, Intent: ${interpretation.intent}.`;
      
      if (interpretation.intent === 'root_cause') {
        // Calculate actual root causes with percentages by comparing first and last month
        const firstMonth = trendData[0]?.value || 0;
        const lastMonth = trendData[trendData.length - 1]?.value || 0;
        const totalChange = firstMonth - lastMonth;
        
        // Analyze product performance
        const productPerformance = new Map();
        allData.forEach(d => {
          const key = d.product;
          if (!productPerformance.has(key)) {
            productPerformance.set(key, { first: 0, last: 0, count: 0 });
          }
          const perf = productPerformance.get(key);
          perf.count++;
          if (d.date <= trendData[0]?.date) perf.first += Number(d[interpretation.metric as keyof typeof d] || 0);
          if (d.date >= trendData[trendData.length - 1]?.date) perf.last += Number(d[interpretation.metric as keyof typeof d] || 0);
        });
        
        // Calculate percentages
        const productImpact = Array.from(productPerformance.entries()).map(([name, perf]) => ({
          name,
          change: perf.first > 0 ? ((perf.first - perf.last) / perf.first) * 100 : 0
        })).sort((a, b) => b.change - a.change);
        
        // Analyze region performance
        const regionPerformance = new Map();
        allData.forEach(d => {
          const key = d.region;
          if (!regionPerformance.has(key)) {
            regionPerformance.set(key, { first: 0, last: 0, count: 0 });
          }
          const perf = regionPerformance.get(key);
          perf.count++;
          if (d.date <= trendData[0]?.date) perf.first += Number(d[interpretation.metric as keyof typeof d] || 0);
          if (d.date >= trendData[trendData.length - 1]?.date) perf.last += Number(d[interpretation.metric as keyof typeof d] || 0);
        });
        
        const regionImpact = Array.from(regionPerformance.entries()).map(([name, perf]) => ({
          name,
          change: perf.first > 0 ? ((perf.first - perf.last) / perf.first) * 100 : 0
        })).sort((a, b) => b.change - a.change);
        
        // Build root causes array with top contributors
        if (productImpact.length > 0) {
          rootCauses.push({
            dimension: "product",
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
      
      // Generate explanation with recommendations
      const explanationCompletion = await openai.chat.completions.create({
         model: "gpt-5.1",
         messages: [
           { role: "system", content: "You are a friendly business analyst. Provide a brief 2-3 sentence summary explaining the data and include 1-2 specific, actionable recommendations to address the issue. Do not use markdown." },
           { role: "user", content: explanationPrompt }
         ]
      });
      const explanation = explanationCompletion.choices[0]?.message?.content || "No explanation could be generated.";

      res.json({
        interpretation,
        trendData,
        breakdownData,
        rootCauses,
        explanation
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

  return httpServer;
}
