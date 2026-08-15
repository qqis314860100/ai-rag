import type { ReactNode } from "react";
import { FileText } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  className = "",
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 text-center ${compact ? "py-8" : "py-16"} ${className}`}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-page text-text-muted">
        {icon || <FileText className="h-6 w-6" />}
      </div>
      <h3 className="text-lg font-medium text-text">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          {description}
        </p>
      )}
      {children && <div className="mt-6 w-full">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
