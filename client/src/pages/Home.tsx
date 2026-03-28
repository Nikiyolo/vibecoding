import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, BarChart3, Search, Lightbulb, AlertTriangle, TrendingDown, TrendingUp, HelpCircle } from "lucide-react";
import { useAnalyzeQuery } from "../hooks/use-analyze";
import { TrendChart, BreakdownChart } from "../components/MetricCharts";
import { DrillDownPanel } from "../components/DrillDownPanel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ContextMenuState {
  barName: string;
  x: number;
  y: number;
}

interface DrillDownResult {
  drillLevel: string;
  parentValue: string;
  data: { name: string; value: number }[];
}

export default function Home() {
  const [query, setQuery] = useState("");
  const analyzeMutation = useAnalyzeQuery();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [drillDownResult, setDrillDownResult] = useState<DrillDownResult | null>(null);

  const drillMutation = useMutation({
    mutationFn: (body: {
      metric: string;
      timeRange?: string;
      parentDimension: string;
      parentValue: string;
      drillLevel: string;
    }) => apiRequest("POST", "/api/drilldown", body).then(r => r.json()),
    onSuccess: (data, variables) => {
      setDrillDownResult({
        drillLevel: variables.drillLevel,
        parentValue: variables.parentValue,
        data: data.drillDownData,
      });
    }
  });

  // Determine parent dimension from current breakdown data
  const getParentDimension = () => {
    const data = (analyzeMutation.data as any)?.breakdownData;
    if (!data || data.length === 0) return "category";
    const regions = ["North America", "Europe", "Asia"];
    if (regions.includes(data[0]?.name)) return "region";
    return "category";
  };

  const handleBarRightClick = (barName: string, x: number, y: number) => {
    setContextMenu({ barName, x, y });
  };

  const handleDrillLevelSelect = (drillLevel: string) => {
    if (!contextMenu || !analyzeMutation.data) return;
    const parentDimension = getParentDimension();
    const metric = (analyzeMutation.data as any).interpretation?.metric || "revenue";
    const timeRange = (analyzeMutation.data as any).interpretation?.timeRange;
    drillMutation.mutate({
      metric,
      timeRange,
      parentDimension,
      parentValue: contextMenu.barName,
      drillLevel,
    });
  };

  // Close context menu on outside click
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Reset drill-down when new query is submitted
  useEffect(() => {
    setDrillDownResult(null);
  }, [analyzeMutation.data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    analyzeMutation.mutate(query);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    analyzeMutation.mutate(suggestion);
  };

  const suggestions = [
    "Why did our revenue drop last month?",
    "What product had the highest profit margin in Q3?",
    "Show me the cost breakdown by region for 2023",
  ];

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-foreground flex flex-col font-sans">
      {/* Header */}
      <header className="px-6 py-5 border-b border-border/50 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">AI Performance Insight</h1>
          </div>
          <div className="hidden md:flex items-center gap-4 text-sm font-medium text-muted-foreground">
            <span className="hover:text-foreground cursor-pointer transition-colors">Dashboard</span>
            <span className="hover:text-foreground cursor-pointer transition-colors">Data Sources</span>
            <span className="hover:text-foreground cursor-pointer transition-colors">Settings</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12 flex flex-col gap-12">
        
        {/* Search Section */}
        <section className="flex flex-col items-center text-center space-y-8 max-w-3xl mx-auto w-full mt-8">
          <div className="space-y-4">
            <motion.h2 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-5xl font-extrabold tracking-tight"
            >
              Ask anything about your <span className="text-gradient">business performance</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg text-muted-foreground"
            >
              Get instant charts, root cause analysis, and AI-driven explanations for your key metrics.
            </motion.p>
          </div>

          <motion.form 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            onSubmit={handleSubmit} 
            className="w-full relative group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 blur-xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative flex items-center bg-card rounded-full p-2 border-2 border-border shadow-xl hover:border-primary/50 transition-colors duration-300">
              <div className="pl-4 pr-2 text-muted-foreground">
                <Search className="w-6 h-6" />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="E.g., Why did revenue drop last month?"
                className="flex-1 bg-transparent border-none outline-none text-lg py-3 px-2 text-foreground placeholder:text-muted-foreground/70"
              />
              <button
                type="submit"
                disabled={analyzeMutation.isPending || !query.trim()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-full font-semibold flex items-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
              >
                {analyzeMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
                      <Sparkles className="w-5 h-5" />
                    </motion.div>
                    Analyzing...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Analyze <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </button>
            </div>
          </motion.form>

          {/* Suggestions - only show if no search is active/done */}
          <AnimatePresence>
            {!analyzeMutation.data && !analyzeMutation.isPending && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-wrap justify-center gap-3 pt-4"
              >
                {suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="px-4 py-2 bg-secondary/50 hover:bg-secondary text-secondary-foreground rounded-full text-sm font-medium transition-colors border border-border/50"
                  >
                    {suggestion}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Error State */}
        {analyzeMutation.isError && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-destructive/10 border border-destructive/20 text-destructive-foreground rounded-2xl p-6 flex items-start gap-4 max-w-3xl mx-auto w-full"
          >
            <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-1" />
            <div>
              <h3 className="font-bold text-destructive">Analysis Failed</h3>
              <p className="text-destructive/80 mt-1">{analyzeMutation.error?.message || "An unexpected error occurred."}</p>
            </div>
          </motion.div>
        )}

        {/* Loading State */}
        {analyzeMutation.isPending && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full"
          >
            <div className="col-span-full flex gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 w-32 bg-secondary rounded-full animate-pulse" />
              ))}
            </div>
            <div className="col-span-1 lg:col-span-1 h-80 bg-secondary/50 rounded-3xl animate-pulse" />
            <div className="col-span-1 lg:col-span-2 h-80 bg-secondary/50 rounded-3xl animate-pulse" />
            <div className="col-span-full h-96 bg-secondary/50 rounded-3xl animate-pulse" />
          </motion.div>
        )}

        {/* Results Dashboard */}
        {analyzeMutation.data && !analyzeMutation.isPending && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col gap-8 w-full"
          >
            {/* Interpretation Badges */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-muted-foreground mr-2 uppercase tracking-wider">Interpreted Query:</span>
              <div className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Metric: {analyzeMutation.data.interpretation.metric}
              </div>
              <div className="px-4 py-2 bg-accent/10 text-accent border border-accent/20 rounded-full font-medium text-sm flex items-center gap-2">
                <Lightbulb className="w-4 h-4" /> Intent: {analyzeMutation.data.interpretation.intent}
              </div>
              <div className="px-4 py-2 bg-secondary text-secondary-foreground border border-border rounded-full font-medium text-sm">
                Time: {analyzeMutation.data.interpretation.timeRange}
              </div>
            </div>

            {/* Determine Layout Type */}
            {(() => {
              const isCausalQuery = analyzeMutation.data.interpretation.intent === "root_cause";
              const hasBreakdown = analyzeMutation.data.breakdownData && analyzeMutation.data.breakdownData.length > 0;
              const topCategory = (analyzeMutation.data as any).topCategory;
              
              // Layout 1: Factual Query (Metric Only) - Just trend chart, possibly with top category
              if (!isCausalQuery && !hasBreakdown) {
                const isHighestQuery = topCategory !== null && topCategory !== undefined;
                const metric = analyzeMutation.data.interpretation.metric;
                const displayMetric = metric === "profit" ? "Profit Margin (%)" : metric.charAt(0).toUpperCase() + metric.slice(1);
                
                return (
                  <div className="w-full flex flex-col gap-6">
                    {isHighestQuery && (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6">
                        <p className="text-sm text-gray-600 uppercase font-semibold mb-2">Highest Category</p>
                        <h2 className="text-3xl font-bold text-foreground">{topCategory}</h2>
                        {metric === "profit" && (
                          <p className="text-sm text-gray-600 mt-2">
                            Shows {displayMetric} trend for {topCategory}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="bg-white border border-gray-200 rounded-2xl p-6">
                      <h3 className="text-lg font-bold mb-6 text-foreground">
                        {displayMetric} Trend
                        {isHighestQuery && topCategory && ` - ${topCategory}`}
                      </h3>
                      <TrendChart 
                        data={analyzeMutation.data.trendData} 
                        title="" 
                      />
                    </div>
                  </div>
                );
              }

              // Layout 2: Factual with Dimension Breakdown - Trend + Breakdown
              if (!isCausalQuery && hasBreakdown) {
                return (
                  <div className="flex flex-col gap-6 w-full">
                    <div className="bg-white border border-gray-200 rounded-2xl p-6">
                      <h3 className="text-lg font-bold mb-6 text-foreground">
                        {analyzeMutation.data.interpretation.metric.charAt(0).toUpperCase() + analyzeMutation.data.interpretation.metric.slice(1)} Trend
                      </h3>
                      <TrendChart 
                        data={analyzeMutation.data.trendData} 
                        title="" 
                      />
                    </div>

                    <div className="bg-white border border-gray-200 rounded-2xl p-6">
                      <h3 className="text-lg font-bold mb-6 text-foreground">Breakdown Impact Analysis</h3>
                      <BreakdownChart 
                        data={analyzeMutation.data.breakdownData} 
                        title="" 
                        onBarRightClick={handleBarRightClick}
                      />
                    </div>

                    {/* Drill-down results */}
                    {(drillMutation.isPending) && (
                      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center h-40">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          <span className="text-sm">Loading drill-down data...</span>
                        </div>
                      </div>
                    )}

                    {drillDownResult && !drillMutation.isPending && drillDownResult.data.length > 0 && (
                      <div className="bg-white border border-blue-200 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-bold text-foreground">Dimension Drill-Down Details</h3>
                        </div>
                        <p className="text-sm text-muted-foreground mb-6">
                          Breakdown of <strong>{drillDownResult.parentValue}</strong> by{" "}
                          <strong className="capitalize">{drillDownResult.drillLevel}</strong>
                        </p>
                        <BreakdownChart 
                          data={drillDownResult.data} 
                          title="" 
                        />
                      </div>
                    )}
                  </div>
                );
              }

              // Layout 3: Causal Query - Full dashboard with sidebar
              if (isCausalQuery) {
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Left Sidebar - Analysis Summary & Suggestions */}
                    <div className="lg:col-span-1 flex flex-col gap-4">
                      
                      {/* Analysis Summary */}
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <TrendingDown className="w-5 h-5 text-purple-600" />
                          <h3 className="font-bold text-sm text-foreground">Analysis Summary</h3>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/85 mb-3">
                          {analyzeMutation.data.trendDescription}
                        </p>
                        {analyzeMutation.data.rootCauses && analyzeMutation.data.rootCauses.length > 0 && (
                          <div className="pt-3 border-t border-purple-200">
                            <p className="text-xs font-semibold text-purple-600 uppercase mb-2">Key Impact Factors:</p>
                            {analyzeMutation.data.rootCauses.map((cause, idx) => (
                              <div key={idx} className="text-xs text-foreground/75">
                                <span className="font-medium">{cause.topContributor}</span>
                                <span className="text-red-600 font-bold ml-1">({cause.dimension})</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Root Causes Detailed */}
                      {analyzeMutation.data.rootCauses && analyzeMutation.data.rootCauses.length > 0 && (
                        <div className="bg-white border border-orange-200 rounded-2xl p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-5 h-5 text-orange-600" />
                            <h3 className="font-bold text-sm text-foreground">Root Causes</h3>
                          </div>
                          <div className="space-y-2 mb-3">
                            {analyzeMutation.data.rootCauses.map((cause, idx) => (
                              <div key={idx} className="pb-2 border-b border-gray-200 last:border-b-0 last:pb-0">
                                <p className="text-xs font-semibold text-gray-500 uppercase">{cause.dimension}</p>
                                <div className="flex items-center justify-between mt-1">
                                  <p className="text-xs font-medium text-foreground">{cause.topContributor}</p>
                                  <span className="text-xs font-bold text-red-600">-{Math.abs(cause.changePercentage)}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs leading-relaxed text-foreground/85 border-t border-gray-200 pt-3">
                            {analyzeMutation.data.rootCausesDescription}
                          </p>
                        </div>
                      )}

                      {/* Actionable Suggestions */}
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Lightbulb className="w-5 h-5 text-green-600" />
                          <h3 className="font-bold text-sm text-foreground">Recommendations</h3>
                        </div>
                        <div className="text-xs leading-relaxed text-foreground/85 prose prose-xs max-w-none prose-headings:text-foreground prose-strong:text-foreground prose-p:my-1 prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {analyzeMutation.data.suggestions}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>

                    {/* Main Content - Charts & Drill-down */}
                    <div className="lg:col-span-3 flex flex-col gap-6">
                      {/* Trend Chart */}
                      <div className="bg-white border border-gray-200 rounded-2xl p-6">
                        <h3 className="text-lg font-bold mb-6 text-foreground">
                          {analyzeMutation.data.interpretation.metric.charAt(0).toUpperCase() + analyzeMutation.data.interpretation.metric.slice(1)} Trend
                        </h3>
                        <TrendChart 
                          data={analyzeMutation.data.trendData} 
                          title="" 
                        />
                      </div>

                      {/* Breakdown Impact Analysis with Drill-down */}
                      {hasBreakdown && (
                        <>
                          <div className="bg-white border border-gray-200 rounded-2xl p-6">
                            <h3 className="text-lg font-bold mb-6 text-foreground">Breakdown Impact Analysis</h3>
                            <BreakdownChart 
                              data={analyzeMutation.data.breakdownData} 
                              title="" 
                              onBarRightClick={handleBarRightClick}
                            />
                          </div>

                          {/* Drill-down loading state */}
                          {drillMutation.isPending && (
                            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center h-40">
                              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                                <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                <span className="text-sm">Loading drill-down data...</span>
                              </div>
                            </div>
                          )}

                          {/* Drill-down results */}
                          {drillDownResult && !drillMutation.isPending && drillDownResult.data.length > 0 && (
                            <div className="bg-white border border-blue-200 rounded-2xl p-6">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-foreground">Dimension Drill-Down Details</h3>
                              </div>
                              <p className="text-sm text-muted-foreground mb-6">
                                Breakdown of <strong>{drillDownResult.parentValue}</strong> by{" "}
                                <strong className="capitalize">{drillDownResult.drillLevel}</strong>
                              </p>
                              <BreakdownChart 
                                data={drillDownResult.data} 
                                title="" 
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              }
            })()}
          </motion.div>
        )}
      </main>

      {/* Context menu for drill-down */}
      {contextMenu && (
        <DrillDownPanel
          anchorX={contextMenu.x}
          anchorY={contextMenu.y}
          barName={contextMenu.barName}
          parentDimension={getParentDimension() as any}
          onDrillLevelSelect={handleDrillLevelSelect}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
