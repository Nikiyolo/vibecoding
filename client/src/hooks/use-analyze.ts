import { useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useAnalyzeQuery() {
  return useMutation({
    mutationFn: async (query: string) => {
      const res = await fetch(api.analyze.query.path, {
        method: api.analyze.query.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        credentials: "include",
      });
      
      if (!res.ok) {
        let errorMsg = "Failed to analyze query";
        try {
          const errData = await res.json();
          if (errData.message) errorMsg = errData.message;
        } catch (e) {
          // ignore parsing error
        }
        throw new Error(errorMsg);
      }
      
      const data = await res.json();
      return api.analyze.query.responses[200].parse(data);
    },
  });
}
