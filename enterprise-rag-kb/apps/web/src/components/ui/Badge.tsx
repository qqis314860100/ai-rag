import type { ReactNode } from "react";

type StatusVariant =
  | "active"
  | "indexing"
  | "ready"
  | "pending"
  | "processing"
  | "failed"
  | "error"
  | "deleted"
  | "archived";

type SecurityVariant = "public" | "internal" | "confidential" | "restricted";

type BadgeVariant = StatusVariant | SecurityVariant;

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  active: "bg-success-soft text-success",
  indexing: "bg-accent-soft text-accent",
  ready: "bg-success-soft text-success",
  pending: "bg-primary-soft text-primary",
  processing: "bg-accent-soft text-accent",
  failed: "bg-error-soft text-error",
  error: "bg-error-soft text-error",
  deleted: "bg-error-soft text-error",
  archived: "bg-warning-soft text-warning",
  public: "bg-success-soft text-success",
  internal: "bg-primary-soft text-primary",
  confidential: "bg-warning-soft text-warning",
  restricted: "bg-error-soft text-error",
};

const labelMap: Record<BadgeVariant, string> = {
  active: "活跃",
  indexing: "索引中",
  ready: "已就绪",
  pending: "待处理",
  processing: "处理中",
  failed: "失败",
  error: "错误",
  deleted: "已删除",
  archived: "已归档",
  public: "公开",
  internal: "内部",
  confidential: "保密",
  restricted: "受限",
};

export function getBadgeLabel(variant: BadgeVariant): string {
  return labelMap[variant] || variant;
}

export default function Badge({ variant, children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
