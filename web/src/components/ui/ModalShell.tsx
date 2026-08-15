import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalShellProps {
  title: string;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  maxWidthClassName?: string;
}

export default function ModalShell({
  title,
  eyebrow,
  icon,
  actions,
  children,
  onClose,
  maxWidthClassName = "max-w-7xl",
}: ModalShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 p-0 backdrop-blur-sm sm:px-4 sm:py-6" onClick={onClose}>
      <div
        className={`mx-auto flex h-full w-full ${maxWidthClassName} flex-col overflow-hidden border border-border bg-white shadow-xl-soft sm:max-h-[880px] sm:rounded-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-divider px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && <p className="text-xs font-medium text-text-muted">{eyebrow}</p>}
              <h2 className="truncate text-base font-semibold text-text">{title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              title="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
