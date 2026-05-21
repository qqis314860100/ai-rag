import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-surface rounded-md shadow-sm-soft border p-4 ${
        onClick ? "cursor-pointer hover:shadow-md-soft transition-shadow" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
