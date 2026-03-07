import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, BarChart3, Search, Lightbulb, AlertTriangle, TrendingDown, TrendingUp, HelpCircle } from "lucide-react";
import { useAnalyzeQuery } from "../hooks/use-analyze";
import { TrendChart, BreakdownChart } from "../components/MetricCharts";

export default function Home() {
  const [query, setQuery] = useState("");
  const analyzeMutation = useAnalyzeQuery();

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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Executive Summary & Root Cause */}
              <div className="col-span-1 flex flex-col gap-6">
                <div className="bg-card border border-border shadow-xl shadow-black/5 rounded-3xl p-6 h-full flex flex-col relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                  
                  <div className="flex items-center gap-3 mb-4 text-primary">
                    <Sparkles className="w-6 h-6" />
                    <h3 className="text-xl font-bold text-foreground">AI Insight</h3>
                  </div>
                  
                  <p className="text-muted-foreground leading-relaxed flex-1">
                    {analyzeMutation.data.explanation}
                  </p>

                  {analyzeMutation.data.rootCauses && analyzeMutation.data.rootCauses.length > 0 && (
                    <div className="mt-8 space-y-3">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600" />
                        Root Causes
                      </h4>
                      {analyzeMutation.data.rootCauses.map((cause, idx) => (
                        <div key={idx} className="bg-orange-50/60 border border-orange-100/60 rounded-xl p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="w-8 h-8 rounded-lg bg-orange-200/40 flex items-center justify-center shrink-0">
                              {cause.dimension === "product" ? (
                                <span className="text-lg">📊</span>
                              ) : (
                                <span className="text-lg">🌍</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-orange-700 uppercase tracking-wider">{cause.dimension}</p>
                              <p className="text-sm font-medium text-orange-900">{cause.topContributor}</p>
                            </div>
                          </div>
                          <span className="text-lg font-bold text-red-600 flex items-center gap-1 shrink-0 ml-2">
                            <TrendingDown className="w-4 h-4" />
                            {Math.abs(cause.changePercentage)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Charts */}
              <div className="col-span-1 lg:col-span-2 flex flex-col gap-6">
                <div className="bg-card border border-border shadow-xl shadow-black/5 rounded-3xl p-6 w-full">
                  <TrendChart 
                    data={analyzeMutation.data.trendData} 
                    title="Performance Trend Over Time" 
                  />
                </div>
              </div>

              <div className="col-span-full">
                <div className="bg-card border border-border shadow-xl shadow-black/5 rounded-3xl p-6 w-full">
                  <BreakdownChart 
                    data={analyzeMutation.data.breakdownData} 
                    title="Metric Breakdown" 
                  />
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
