import { lazy, Suspense } from "react";
import type { Source } from "../types";

const DocPreview = lazy(() => import("./DocPreview"));

interface DocPreviewDrawerProps {
  source: Source;
  onClose: () => void;
  onAskAbout: (source: Source) => void;
}

export default function DocPreviewDrawer({ source, onClose, onAskAbout }: DocPreviewDrawerProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-[384px] max-w-[90vw] bg-surface shadow-xl-soft z-50 animate-fade-in-right border-l border-divider overflow-hidden">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-text-muted">预览加载中...</div>}>
          <DocPreview source={source} onClose={onClose} onAskAbout={onAskAbout} />
        </Suspense>
      </aside>
    </>
  );
}
