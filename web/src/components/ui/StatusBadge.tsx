import type { ReactNode } from "react";

interface StatusBadgeProps {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "success" | "danger" | "warning" | "muted" | "accent";
  className?: string;
}

const toneClasses: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  muted: "bg-surface-hover text-text-muted",
  accent: "bg-accent-soft text-accent",
};

export default function StatusBadge({ children, icon, tone = "muted", className = "" }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${toneClasses[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
