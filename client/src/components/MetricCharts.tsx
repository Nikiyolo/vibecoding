import { useState, useRef } from "react";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  Cell,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from "recharts";

interface ChartProps {
  data: any[];
  title: string;
}

interface BreakdownChartProps extends ChartProps {
  onBarRightClick?: (barName: string, x: number, y: number) => void;
}

// Utility to auto-detect the likely X and Y axes from dynamic data
function detectAxes(data: any[]) {
  if (!data || data.length === 0) return { x: '', y: '' };
  const keys = Object.keys(data[0]);
  // We assume the first string/date-looking key is X, the first number-looking key is Y.
  // Fallback to first and second key if types aren't clear.
  let x = keys[0];
  let y = keys.length > 1 ? keys[1] : keys[0];
  
  for (const k of keys) {
    const val = data[0][k];
    if (typeof val === 'number' && k !== 'id') {
      y = k;
      break;
    }
  }
  return { x, y };
}

export function TrendChart({ data, title }: ChartProps) {
  if (!data || data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">No trend data available</div>;
  }

  const { x, y } = detectAxes(data);
  
  // Ensure data values are numbers
  const processedData = data.map(item => ({
    ...item,
    [y]: Number(item[y as keyof typeof item]) || 0
  }));

  // Check if this is multi-series data (multiple value columns besides the x-axis)
  const dataKeys = Object.keys(processedData[0]);
  const valueKeys = dataKeys.filter(key => key !== x && typeof processedData[0][key] === 'number');
  const isMultiSeries = valueKeys.length > 1;
  
  // Define color palette for multi-series
  const colorPalette = [
    'hsl(var(--primary))',
    'hsl(220 90% 60%)',      // Blue variant
    'hsl(142 71% 45%)',      // Green
    'hsl(0 84% 60%)',        // Red
    'hsl(38 92% 50%)',       // Orange
    'hsl(280 85% 55%)',      // Purple
  ];

  return (
    <div className="w-full flex flex-col h-full">
      {title && <h3 className="text-lg font-semibold mb-6">{title}</h3>}
      <div className="flex-1 min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={350}>
          <LineChart 
            data={processedData} 
            margin={{ top: 10, right: 30, left: 0, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis 
              dataKey={x} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              tickFormatter={(value) => {
                if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
                // For percentages (profit margin), don't add $
                if (value < 100 && value > 0) return `${value.toFixed(0)}%`;
                return `$${value}`;
              }}
              width={60}
            />
            <Tooltip 
              contentStyle={{ 
                borderRadius: '12px', 
                border: 'none', 
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                backgroundColor: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))'
              }}
              labelStyle={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}
              formatter={(value: any) => {
                const num = Number(value) || 0;
                if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
                if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
                // For percentages, check if it looks like a percentage
                if (num < 100 && num > 0) return `${num.toFixed(1)}%`;
                return `$${num.toFixed(2)}`;
              }}
            />
            {isMultiSeries ? (
              <>
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {valueKeys.map((key, index) => (
                  <Line 
                    key={key}
                    type="linear" 
                    dataKey={key} 
                    stroke={colorPalette[index % colorPalette.length]} 
                    strokeWidth={3}
                    dot={{ r: 5, fill: colorPalette[index % colorPalette.length], strokeWidth: 0 }}
                    activeDot={{ r: 7, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                    animationDuration={1500}
                    isAnimationActive={true}
                    name={key}
                  />
                ))}
              </>
            ) : (
              <Line 
                type="linear" 
                dataKey={y} 
                stroke="hsl(var(--primary))" 
                strokeWidth={3}
                dot={{ r: 5, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                activeDot={{ r: 7, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                animationDuration={1500}
                isAnimationActive={true}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BreakdownChart({ data, title, onBarRightClick }: BreakdownChartProps) {
  const hoveredBarRef = useRef<{ name: string; clientX: number; clientY: number } | null>(null);

  if (!data || data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">No breakdown data available</div>;
  }

  const { x, y } = detectAxes(data);
  
  // Ensure data values are numbers and sort by value descending
  const processedData = data
    .map(item => ({
      ...item,
      [y]: Number(item[y as keyof typeof item]) || 0
    }))
    .sort((a, b) => Number(b[y]) - Number(a[y]));

  // Color palette for different dimension values
  const colorPalette = [
    'hsl(220 90% 60%)',      // Blue
    'hsl(142 71% 45%)',      // Green
    'hsl(0 84% 60%)',        // Red
    'hsl(38 92% 50%)',       // Orange
    'hsl(280 85% 55%)',      // Purple
    'hsl(200 80% 50%)',      // Cyan
  ];

  return (
    <div className="w-full flex flex-col h-full">
      {title && <h3 className="text-lg font-semibold mb-6">{title}</h3>}
      {onBarRightClick && (
        <p className="text-xs text-muted-foreground mb-3 italic">Click or right-click a bar to drill down</p>
      )}
      <div
        className="flex-1 min-h-[300px] w-full"
        onContextMenu={(e) => {
          if (!onBarRightClick) return;
          e.preventDefault();
          if (hoveredBarRef.current) {
            onBarRightClick(hoveredBarRef.current.name, e.clientX, e.clientY);
          }
        }}
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart 
            data={processedData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 120, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis 
              type="number"
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              tickFormatter={(value) => {
                if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
                // For percentages
                if (value < 100 && value > 0) return `${value.toFixed(0)}%`;
                return `$${value}`;
              }}
            />
            <YAxis 
              dataKey={x}
              type="category"
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              width={110}
            />
            <Tooltip 
              contentStyle={{ 
                borderRadius: '12px', 
                border: 'none', 
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                backgroundColor: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))'
              }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
              formatter={(value: any) => {
                const num = Number(value) || 0;
                if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
                if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
                // For percentages
                if (num < 100 && num > 0) return `${num.toFixed(1)}%`;
                return `$${num.toFixed(2)}`;
              }}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
            />
            <Bar 
              dataKey={y}
              radius={[0, 8, 8, 0]}
              animationDuration={1500}
              onMouseEnter={(data: any, _: number, e: any) => {
                if (data) hoveredBarRef.current = { name: data[x], clientX: e?.clientX || 0, clientY: e?.clientY || 0 };
              }}
              onMouseLeave={() => { hoveredBarRef.current = null; }}
              onContextMenu={(data: any, _: number, e: any) => {
                e.preventDefault();
                e.stopPropagation();
                if (onBarRightClick && data) {
                  onBarRightClick(data[x], e.clientX, e.clientY);
                }
              }}
              onClick={(data: any, _: number, e: any) => {
                if (onBarRightClick && data) {
                  const rect = (e.currentTarget as SVGElement)?.getBoundingClientRect?.();
                  const clientX = rect ? rect.right : e.clientX;
                  const clientY = rect ? rect.top + rect.height / 2 : e.clientY;
                  onBarRightClick(data[x], clientX, clientY);
                }
              }}
              cursor={onBarRightClick ? "pointer" : "default"}
            >
              {processedData.map((_, index) => (
                <Cell 
                  key={`cell-${index}`}
                  fill={colorPalette[index % colorPalette.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Clickable dimension list for drill-down */}
      {onBarRightClick && processedData.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {processedData.map((item, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onBarRightClick(String(item[x]), rect.right, rect.top + rect.height / 2);
              }}
              data-testid={`drilldown-bar-${String(item[x]).toLowerCase().replace(/\s+/g, '-')}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105"
              style={{ 
                backgroundColor: colorPalette[index % colorPalette.length] + '20',
                color: colorPalette[index % colorPalette.length],
                border: `1px solid ${colorPalette[index % colorPalette.length]}40`
              }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: colorPalette[index % colorPalette.length] }}
              />
              {String(item[x])}
              <span className="opacity-60">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
