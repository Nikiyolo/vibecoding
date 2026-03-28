interface CrossTableRow {
  category: string;
  values: Record<string, number>;
  rowTotal: number;
}

interface CrossTableData {
  regions: string[];
  rows: CrossTableRow[];
  columnTotals: Record<string, number>;
  grandTotal: number;
}

interface CrossTableProps {
  data: CrossTableData;
  metric: string;
}

function formatValue(value: number, metric: string): string {
  if (metric === "profit") return `${value.toFixed(1)}%`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function getHeatColor(value: number, min: number, max: number, metric: string): string {
  if (max === min) return "hsl(210 80% 95%)";
  const ratio = (value - min) / (max - min);
  if (metric === "profit") {
    // Green gradient for profit margin
    const lightness = Math.round(95 - ratio * 35);
    const saturation = Math.round(40 + ratio * 40);
    return `hsl(142 ${saturation}% ${lightness}%)`;
  }
  // Blue gradient for revenue/cost
  const lightness = Math.round(95 - ratio * 35);
  const saturation = Math.round(40 + ratio * 45);
  return `hsl(210 ${saturation}% ${lightness}%)`;
}

function getTextColor(value: number, min: number, max: number): string {
  if (max === min) return "hsl(var(--foreground))";
  const ratio = (value - min) / (max - min);
  return ratio > 0.6 ? "hsl(220 30% 20%)" : "hsl(var(--foreground))";
}

export function CrossTable({ data, metric }: CrossTableProps) {
  if (!data || !data.rows || data.rows.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
        No cross-table data available
      </div>
    );
  }

  // Find min/max across all cell values for heat-map scaling
  const allCellValues = data.rows.flatMap(row =>
    data.regions.map(region => row.values[region] ?? 0)
  );
  const minVal = Math.min(...allCellValues);
  const maxVal = Math.max(...allCellValues);

  const metricLabel =
    metric === "profit" ? "Profit Margin" :
    metric === "cost" ? "Cost" : "Revenue";

  return (
    <div className="w-full overflow-x-auto" data-testid="cross-table">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {/* Corner header */}
            <th className="text-left py-3 px-4 font-semibold text-muted-foreground bg-gray-50 border border-gray-200 rounded-tl-lg min-w-[140px]">
              Product ↓ / Region →
            </th>
            {data.regions.map(region => (
              <th
                key={region}
                className="py-3 px-4 text-center font-semibold text-foreground bg-gray-50 border border-gray-200 whitespace-nowrap"
                data-testid={`cross-table-col-${region.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {region}
              </th>
            ))}
            <th className="py-3 px-4 text-center font-semibold text-foreground bg-gray-100 border border-gray-200 rounded-tr-lg whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIdx) => {
            const isLast = rowIdx === data.rows.length - 1;
            return (
              <tr key={row.category} className="group">
                {/* Row label */}
                <td
                  className={`py-3 px-4 font-semibold text-foreground border border-gray-200 bg-gray-50 ${isLast ? "rounded-bl-none" : ""}`}
                  data-testid={`cross-table-row-${row.category.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {row.category}
                </td>

                {/* Data cells */}
                {data.regions.map(region => {
                  const val = row.values[region] ?? 0;
                  const bg = getHeatColor(val, minVal, maxVal, metric);
                  const fg = getTextColor(val, minVal, maxVal);
                  return (
                    <td
                      key={region}
                      className="py-3 px-4 text-center font-medium border border-gray-200 transition-all"
                      style={{ backgroundColor: bg, color: fg }}
                      data-testid={`cross-table-cell-${row.category.toLowerCase().replace(/\s+/g, '-')}-${region.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {formatValue(val, metric)}
                    </td>
                  );
                })}

                {/* Row total */}
                <td
                  className="py-3 px-4 text-center font-bold text-foreground border border-gray-200 bg-gray-100"
                >
                  {formatValue(row.rowTotal, metric)}
                </td>
              </tr>
            );
          })}

          {/* Column totals row */}
          <tr className="border-t-2 border-gray-300">
            <td className="py-3 px-4 font-bold text-foreground bg-gray-100 border border-gray-200 rounded-bl-lg">
              Total
            </td>
            {data.regions.map(region => (
              <td
                key={region}
                className="py-3 px-4 text-center font-bold text-foreground bg-gray-100 border border-gray-200"
              >
                {formatValue(data.columnTotals[region] ?? 0, metric)}
              </td>
            ))}
            <td className="py-3 px-4 text-center font-bold text-foreground bg-gray-200 border border-gray-200 rounded-br-lg">
              {formatValue(data.grandTotal, metric)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2 justify-end">
        <span className="text-xs text-muted-foreground">Lower</span>
        <div
          className="h-3 w-24 rounded"
          style={{
            background: metric === "profit"
              ? "linear-gradient(to right, hsl(142 40% 95%), hsl(142 80% 60%))"
              : "linear-gradient(to right, hsl(210 40% 95%), hsl(210 85% 60%))"
          }}
        />
        <span className="text-xs text-muted-foreground">Higher</span>
        <span className="text-xs text-muted-foreground ml-2 italic">{metricLabel}</span>
      </div>
    </div>
  );
}
