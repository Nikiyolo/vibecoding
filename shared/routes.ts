import { z } from 'zod';
import { performanceMetrics } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  metrics: {
    list: {
      method: 'GET' as const,
      path: '/api/metrics' as const,
      responses: {
        200: z.array(z.custom<typeof performanceMetrics.$inferSelect>()),
      },
    },
  },
  analyze: {
    query: {
      method: 'POST' as const,
      path: '/api/analyze' as const,
      input: z.object({
        query: z.string(),
      }),
      responses: {
        200: z.object({
          interpretation: z.object({
            metric: z.string(),
            timeRange: z.string(),
            intent: z.string(),
          }),
          trendData: z.array(z.any()),
          crossTableData: z.object({
            regions: z.array(z.string()),
            rows: z.array(z.object({
              category: z.string(),
              values: z.record(z.string(), z.number()),
              rowTotal: z.number(),
            })),
            columnTotals: z.record(z.string(), z.number()),
            grandTotal: z.number(),
          }).optional(),
          breakdownData: z.array(z.any()),
          rootCauses: z.array(z.object({
            dimension: z.string(),
            topContributor: z.string(),
            changePercentage: z.number(),
          })),
          trendDescription: z.string(),
          rootCausesDescription: z.string(),
          suggestions: z.string(),
          topCategory: z.string().nullable().optional(),
          causalCrossTableData: z.object({
            currentLabel: z.string(),
            previousLabel: z.string(),
            regions: z.array(z.string()),
            rows: z.array(z.object({
              category: z.string(),
              currentValues: z.record(z.string(), z.number()),
              previousValues: z.record(z.string(), z.number()),
              currentRowTotal: z.number(),
              previousRowTotal: z.number(),
            })),
            currentColumnTotals: z.record(z.string(), z.number()),
            previousColumnTotals: z.record(z.string(), z.number()),
            currentGrandTotal: z.number(),
            prevGrandTotal: z.number(),
          }).nullable().optional(),
        }),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
