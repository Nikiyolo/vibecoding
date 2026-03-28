interface CausalCrossTableRow {
  category: string;
  currentValues: Record<string, number>;
  previousValues: Record<string, number>;
  currentRowTotal: number;
  previousRowTotal: number;
}

interface CausalCrossTableData {
  currentLabel: string;
  previousLabel: string;
  regions: string[];
  rows: CausalCrossTableRow[];
  currentColumnTotals: Record<string, number>;
  previousColumnTotals: Record<string, number>;
  currentGrandTotal: number;
  prevGrandTotal: number;
}

interface CausalCrossTableProps {
  data: CausalCrossTableData;
  metric: string;
}

function formatValue(value: number, metric: string): string {
  if (metric === "profit_margin") return `${value.toFixed(1)}%`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function getHeatColor(value: number, min: number, max: number, metric: string): string {
  if (max === min) return "hsl(210 70% 96%)";
  const ratio = (value - min) / (max - min);
  if (metric === "profit_margin" || metric === "profit") {
    const lightness = Math.round(96 - ratio * 36);
    const saturation = Math.round(40 + ratio * 40);
    return `hsl(142 ${saturation}% ${lightness}%)`;
  }
  const lightness = Math.round(96 - ratio * 36);
  const saturation = Math.round(40 + ratio * 45);
  return `hsl(210 ${saturation}% ${lightness}%)`;
}

function getTextColor(value: number, min: number, max: number): string {
  if (max === min) return "hsl(var(--foreground))";
  const ratio = (value - min) / (max - min);
  return ratio > 0.6 ? "hsl(220 30% 18%)" : "hsl(var(--foreground))";
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function ChangeCell({ current, previous }: { current: number; previous: number }) {
  const pct = changePct(current, previous);
  if (pct === null) return <td className="py-2.5 px-3 text-center text-xs text-muted-foreground border border-gray-200 bg-gray-50">—</td>;
  const positive = pct >= 0;
  const color = positive ? "text-emerald-600" : "text-red-500";
  const bg = positive ? "bg-emerald-50" : "bg-red-50";
  const arrow = positive ? "▲" : "▼";
  return (
    <td
      className={`py-2.5 px-3 text-center text-xs font-semibold border border-gray-200 ${color} ${bg}`}
      data-testid="causal-change-cell"
    >
      {arrow} {Math.abs(pct).toFixed(1)}%
    </td>
  );
}

export function CausalCrossTable({ data, metric }: CausalCrossTableProps) {
  if (!data || !data.rows || data.rows.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
        No comparison data available
      </div>
    );
  }

  const { regions, rows, currentLabel, previousLabel } = data;

  // Compute heat-map range across ALL cells in both periods
  const allCellVals = rows.flatMap(r => [
    ...regions.map(reg => r.currentValues[reg] ?? 0),
    ...regions.map(reg => r.previousValues[reg] ?? 0),
  ]);
  const minVal = Math.min(...allCellVals);
  const maxVal = Math.max(...allCellVals);

  const metricLabel =
    metric === "profit_margin" ? "Profit Margin" :
    metric === "profit" ? "Profit" :
    metric === "cost" ? "Cost" : "Revenue";

  const periodColSpan = regions.length + 1; // regions + Total column

  return (
    <div className="w-full overflow-x-auto" data-testid="causal-cross-table">
      <table className="w-full border-collapse text-sm">
        <thead>
          {/* Top-level period headers */}
          <tr>
            <th
              rowSpan={2}
              className="py-3 px-4 text-left font-semibold text-muted-foreground bg-gray-50 border border-gray-200 rounded-tl-lg min-w-[140px] align-bottom"
            >
              Product ↓ / Region →
            </th>
            <th
              colSpan={periodColSpan}
              className="py-2 px-4 text-center font-bold text-blue-700 bg-blue-50 border border-gray-200 tracking-wide"
            >
              {currentLabel}
            </th>
            <th
              colSpan={periodColSpan}
              className="py-2 px-4 text-center font-bold text-slate-600 bg-slate-50 border border-gray-200 tracking-wide"
            >
              {previousLabel}
            </th>
            <th
              rowSpan={2}
              className="py-2 px-3 text-center font-semibold text-muted-foreground bg-gray-50 border border-gray-200 rounded-tr-lg align-bottom text-xs whitespace-nowrap"
            >
              Δ Change
            </th>
          </tr>
          {/* Region sub-headers */}
          <tr>
            {/* Current period regions + total */}
            {regions.map(r => (
              <th
                key={`cur-${r}`}
                className="py-2 px-3 text-center font-semibold text-foreground bg-blue-50 border border-gray-200 whitespace-nowrap text-xs"
              >
                {r}
              </th>
            ))}
            <th className="py-2 px-3 text-center font-semibold text-foreground bg-blue-100 border border-gray-200 whitespace-nowrap text-xs">
              Total
            </th>
            {/* Previous period regions + total */}
            {regions.map(r => (
              <th
                key={`prev-${r}`}
                className="py-2 px-3 text-center font-semibold text-foreground bg-slate-50 border border-gray-200 whitespace-nowrap text-xs"
              >
                {r}
              </th>
            ))}
            <th className="py-2 px-3 text-center font-semibold text-foreground bg-slate-100 border border-gray-200 whitespace-nowrap text-xs">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.category} className="group">
              {/* Row label */}
              <td
                className="py-2.5 px-4 font-semibold text-foreground border border-gray-200 bg-gray-50 whitespace-nowrap"
                data-testid={`causal-row-${row.category.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {row.category}
              </td>

              {/* Current period cells */}
              {regions.map(r => {
                const val = row.currentValues[r] ?? 0;
                const bg = getHeatColor(val, minVal, maxVal, metric);
                const fg = getTextColor(val, minVal, maxVal);
                return (
                  <td
                    key={`cur-${r}`}
                    className="py-2.5 px-3 text-center font-medium border border-gray-200 transition-all"
                    style={{ backgroundColor: bg, color: fg }}
                    data-testid={`causal-cur-${row.category.toLowerCase().replace(/\s+/g, '-')}-${r.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {formatValue(val, metric)}
                  </td>
                );
              })}
              {/* Current row total */}
              <td className="py-2.5 px-3 text-center font-bold text-blue-800 bg-blue-100 border border-gray-200">
                {formatValue(row.currentRowTotal, metric)}
              </td>

              {/* Previous period cells */}
              {regions.map(r => {
                const val = row.previousValues[r] ?? 0;
                const bg = getHeatColor(val, minVal, maxVal, metric);
                const fg = getTextColor(val, minVal, maxVal);
                return (
                  <td
                    key={`prev-${r}`}
                    className="py-2.5 px-3 text-center font-medium border border-gray-200 transition-all opacity-85"
                    style={{ backgroundColor: bg, color: fg }}
                    data-testid={`causal-prev-${row.category.toLowerCase().replace(/\s+/g, '-')}-${r.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {formatValue(val, metric)}
                  </td>
                );
              })}
              {/* Previous row total */}
              <td className="py-2.5 px-3 text-center font-bold text-slate-600 bg-slate-100 border border-gray-200">
                {formatValue(row.previousRowTotal, metric)}
              </td>

              {/* Change column */}
              <ChangeCell current={row.currentRowTotal} previous={row.previousRowTotal} />
            </tr>
          ))}

          {/* Grand total row */}
          <tr className="border-t-2 border-gray-300">
            <td className="py-2.5 px-4 font-bold text-foreground bg-gray-100 border border-gray-200">
              Total
            </td>
            {/* Current period column totals */}
            {regions.map(r => (
              <td key={`cur-total-${r}`} className="py-2.5 px-3 text-center font-bold text-foreground bg-blue-50 border border-gray-200">
                {formatValue(data.currentColumnTotals[r] ?? 0, metric)}
              </td>
            ))}
            <td className="py-2.5 px-3 text-center font-bold text-blue-800 bg-blue-100 border border-gray-200">
              {formatValue(data.currentGrandTotal, metric)}
            </td>
            {/* Previous period column totals */}
            {regions.map(r => (
              <td key={`prev-total-${r}`} className="py-2.5 px-3 text-center font-bold text-foreground bg-slate-50 border border-gray-200">
                {formatValue(data.previousColumnTotals[r] ?? 0, metric)}
              </td>
            ))}
            <td className="py-2.5 px-3 text-center font-bold text-slate-600 bg-slate-100 border border-gray-200">
              {formatValue(data.prevGrandTotal, metric)}
            </td>
            {/* Grand total change */}
            <ChangeCell current={data.currentGrandTotal} previous={data.prevGrandTotal} />
          </tr>
        </tbody>
      </table>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2 justify-end flex-wrap">
        <span className="text-xs text-muted-foreground">Lower</span>
        <div
          className="h-3 w-24 rounded"
          style={{
            background: (metric === "profit_margin" || metric === "profit")
              ? "linear-gradient(to right, hsl(142 40% 96%), hsl(142 80% 60%))"
              : "linear-gradient(to right, hsl(210 40% 96%), hsl(210 85% 60%))"
          }}
        />
        <span className="text-xs text-muted-foreground">Higher</span>
        <span className="text-xs text-muted-foreground ml-2 italic">{metricLabel}</span>
        <span className="text-xs text-muted-foreground ml-4">
          <span className="text-emerald-600 font-semibold">▲</span> increase &nbsp;
          <span className="text-red-500 font-semibold">▼</span> decrease vs prior period
        </span>
      </div>
    </div>
  );
}
