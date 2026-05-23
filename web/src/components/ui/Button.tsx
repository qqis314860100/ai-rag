import { type ButtonHTMLAttributes, type ReactNode } from "react";
import Spinner from "./Spinner";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<string, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover disabled:bg-text-muted",
  secondary:
    "bg-primary-soft text-primary hover:bg-border disabled:bg-primary-soft/50 disabled:text-text-muted",
  ghost:
    "bg-transparent text-text-secondary hover:bg-primary-soft disabled:text-text-muted",
};

export default function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-fast ease-out focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
