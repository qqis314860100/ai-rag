import { FileSearch, FlaskConical, ShieldCheck, Wrench, Zap } from "lucide-react";

type ChatEmptyWelcomeProps = {
  onQuestion: (question: string) => void;
};

const categories = [
  {
    icon: FlaskConical,
    label: "测试标准",
    prompts: ["绝缘电阻测试的标准是什么？", "OCV 测试包含哪些流程？", "气密测试参数如何设定？"],
  },
  {
    icon: Wrench,
    label: "异常排查",
    prompts: ["焊接飞溅的常见原因有哪些？", "CCD 检测误判怎么分析？", "绝缘不良如何快速定位？"],
  },
  {
    icon: Zap,
    label: "设备操作",
    prompts: ["Busbar 激光焊接关键参数", "电芯分选的标准是什么？", "模组堆叠精度要求是多少？"],
  },
  {
    icon: ShieldCheck,
    label: "安全规范",
    prompts: ["EOL 测试安全注意事项", "高压测试防护要求", "化学品存储规范"],
  },
];

export function ChatEmptyWelcome({ onQuestion }: ChatEmptyWelcomeProps) {
  return (
    <div className="flex flex-col items-center py-12 px-4 text-center animate-fade-in-up">
      <div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center mb-6 shadow-sm-soft">
        <FileSearch className="h-7 w-7 text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-text tracking-tight">电池产线知识库</h2>
      <p className="mt-2 max-w-lg text-[15px] text-text-secondary leading-relaxed">
        基于产线技术文档，为你提供即时、可追溯的工艺问答。
        <br />
        选择一个下方问题开始，或直接输入你的疑问。
      </p>

      <div className="mt-8 w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        {categories.map(({ icon: Icon, label, prompts }) => (
          <div key={label} className="rounded-xl border border-border bg-surface-page p-4 text-left hover:border-accent/25 hover:shadow-sm-soft transition-all duration-normal">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-accent-soft text-accent">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-semibold text-text">{label}</span>
            </div>
            <div className="space-y-1.5">
              {prompts.map((q) => (
                <button
                  key={q}
                  onClick={() => onQuestion(q)}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-[13px] text-text-secondary hover:bg-accent-soft/50 hover:text-accent transition-all duration-fast"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[11px] text-text-muted">
        AI 生成内容仅供参考，请以正式文档为准
      </p>
    </div>
  );
}
