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
          trendData: z.array(z.any()), // flexible array for charts
          breakdownData: z.array(z.any()),
          rootCauses: z.array(z.object({
            dimension: z.string(),
            topContributor: z.string(),
            changePercentage: z.number(),
          })),
          explanation: z.string(),
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
