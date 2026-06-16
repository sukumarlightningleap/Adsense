"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TrendPoint } from "@/lib/dashboard/kpis";

type Props = {
  data: TrendPoint[];
  /** Which series to plot. */
  metric: "clicks" | "spendUsd";
};

const METRIC_LABEL: Record<Props["metric"], string> = {
  clicks: "Clicks",
  spendUsd: "Spend",
};

export function TrendChart({ data, metric }: Props) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 16, left: 8, bottom: 12 }}
        >
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--brand)"
                stopOpacity={0.18}
              />
              <stop
                offset="100%"
                stopColor="var(--brand)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => v.slice(5)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            minTickGap={20}
          />
          <YAxis
            tickFormatter={(v: number) =>
              metric === "spendUsd"
                ? `$${v.toLocaleString("en-US")}`
                : v.toLocaleString("en-US")
            }
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            width={56}
          />
          <Tooltip
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeDasharray: "2 4",
              strokeOpacity: 0.6,
            }}
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              padding: "8px 10px",
              boxShadow: "0 6px 24px -6px rgba(0,0,0,0.12)",
            }}
            labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
            formatter={(value) => {
              const n =
                typeof value === "number" ? value : Number(value) || 0;
              return [
                metric === "spendUsd"
                  ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                  : n.toLocaleString("en-US"),
                METRIC_LABEL[metric],
              ];
            }}
            labelFormatter={(label) => String(label ?? "")}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke="var(--brand)"
            strokeWidth={2}
            fill="url(#trendFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
