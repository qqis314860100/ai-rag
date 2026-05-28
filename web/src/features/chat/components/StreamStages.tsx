import { useEffect, useState } from "react";
import { Check, FileCheck, MessageSquare, Search } from "lucide-react";

const stages = [
  { icon: Search, label: "检索知识库..." },
  { icon: FileCheck, label: "匹配相关文档..." },
  { icon: MessageSquare, label: "生成答案中..." },
];

export function StreamStages() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 600);
    const t2 = setTimeout(() => setStage(2), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {stages.map((s, i) => {
        const isActive = i <= stage;
        const isCurrent = i === stage;
        const StepIcon = s.icon;
        return (
          <div
            key={i}
            className={`flex items-center gap-2.5 text-sm transition-all duration-normal ${
              isActive ? "text-text-secondary" : "text-text-muted/30"
            } ${isCurrent ? "font-medium" : ""}`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-full transition-all duration-normal ${
              isCurrent ? "bg-accent-soft text-accent animate-pulseGlow" :
              i < stage ? "bg-success-soft text-success" :
              "bg-surface-hover text-text-muted/30"
            }`}>
              {i < stage ? <Check className="h-3 w-3" /> : <StepIcon className="h-3 w-3" />}
            </span>
            <span>{s.label}</span>
            {isCurrent && (
              <span className="flex gap-1 ml-1">
                <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
