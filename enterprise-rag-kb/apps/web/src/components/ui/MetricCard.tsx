import type { ReactNode } from "react";

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export default function MetricCard({ icon, label, value, subtitle, trend, className = "" }: MetricCardProps) {
  return (
    <div className={`glass rounded-lg p-5 shadow-sm-soft flex items-start gap-4 hover-lift cursor-default ${className}`}>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent shadow-sm">
        {icon}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">{label}</span>
        <span className="text-2xl font-bold text-text tracking-tight">{value}</span>
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
        {trend && (
          <span className={`text-xs font-semibold ${trend.positive ? "text-success" : "text-danger"}`}>
            {trend.positive ? "▲" : "▼"} {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
