import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  children: ReactNode;
  size?: "xs" | "sm";
  tone?: "neutral" | "accent" | "danger";
}

const toneClasses: Record<NonNullable<ActionButtonProps["tone"]>, string> = {
  neutral: "text-text-secondary hover:border-accent/50 hover:text-accent",
  accent: "text-accent hover:border-accent/60 hover:bg-accent-soft/40",
  danger: "text-text-muted hover:border-danger/40 hover:text-danger",
};

const sizeClasses: Record<NonNullable<ActionButtonProps["size"]>, string> = {
  xs: "px-2.5 py-1.5 text-[11px]",
  sm: "px-2.5 py-1.5 text-xs",
};

export default function ActionButton({
  icon,
  children,
  size = "sm",
  tone = "neutral",
  className = "",
  disabled,
  ...props
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-white font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
