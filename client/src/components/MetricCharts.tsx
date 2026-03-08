import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
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

  return (
    <div className="w-full flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-6">{title}</h3>
      <div className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis 
              dataKey={x} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              tickFormatter={(value) => {
                if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
                return value;
              }}
            />
            <Tooltip 
              contentStyle={{ 
                borderRadius: '12px', 
                border: 'none', 
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)' 
              }}
              labelStyle={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}
            />
            <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }}/>
            <Line 
              type="monotone" 
              dataKey={y} 
              stroke="hsl(var(--primary))" 
              strokeWidth={3}
              dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
              activeDot={{ r: 6, stroke: "hsl(var(--background))", strokeWidth: 2 }}
              animationDuration={1500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BreakdownChart({ data, title }: ChartProps) {
  if (!data || data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">No breakdown data available</div>;
  }

  const { x, y } = detectAxes(data);
  
  // Ensure data values are numbers
  const processedData = data.map(item => ({
    ...item,
    [y]: Number(item[y as keyof typeof item]) || 0
  }));

  return (
    <div className="w-full flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-6">{title}</h3>
      <div className="flex-1 min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart 
            data={processedData}
            margin={{ top: 10, right: 30, left: 10, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis 
              dataKey={x} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              tickFormatter={(value) => {
                if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
                return `$${value}`;
              }}
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
                return `$${num.toFixed(2)}`;
              }}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
            />
            <Bar 
              dataKey={y} 
              fill="hsl(var(--chart-1))" 
              radius={[8, 8, 0, 0]}
              animationDuration={1500}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
