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
      
      let rootCause;
      let explanationPrompt = `Explain the following data findings based on the user's query: "${query}".
      Metric: ${interpretation.metric}, TimeRange: ${interpretation.timeRange}, Intent: ${interpretation.intent}.`;
      
      if (interpretation.intent === 'root_cause') {
        // Find top contributor (mock logic)
        const sortedBreakdown = [...breakdownData].sort((a, b) => b.value - a.value);
        if (sortedBreakdown.length > 0) {
          rootCause = {
            dimension: "product",
            topContributor: sortedBreakdown[0].name,
            changePercentage: 15.2, // mock value
          };
          explanationPrompt += `\nWe found that ${rootCause.topContributor} is the largest driver of the ${interpretation.metric}.`;
        }
      }
      
      // Generate explanation
      const explanationCompletion = await openai.chat.completions.create({
         model: "gpt-5.1",
         messages: [
           { role: "system", content: "You are a friendly business analyst. Provide a brief, 1-3 sentence summary explaining the data. Do not use markdown." },
           { role: "user", content: explanationPrompt }
         ]
      });
      const explanation = explanationCompletion.choices[0]?.message?.content || "No explanation could be generated.";

      res.json({
        interpretation,
        trendData,
        breakdownData,
        rootCause,
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
