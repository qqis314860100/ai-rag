import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react";
import { uploadWithProgress } from "../../services/api";
import { showToast } from "../ui/Toast";
import { Button, Input, Modal } from "../ui";

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = ["模组组装", "电芯制造", "检测设备", "设备维护", "安全规范", "质量控制", "工艺参数", "其他"];
const SECURITY_LEVELS = [
  { value: "public", label: "公开" },
  { value: "internal", label: "内部" },
  { value: "confidential", label: "保密" },
  { value: "restricted", label: "受限" },
];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

export default function UploadModal({ open, onClose, onSuccess }: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [securityLevel, setSecurityLevel] = useState("internal");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [stage, setStage] = useState<"idle" | "uploading" | "indexing" | "done">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    const valid: File[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const f = newFiles[i];
      if (f.size > MAX_SIZE) { setError(`${f.name} 超过 20MB 限制`); continue; }
      valid.push(f);
    }
    if (valid.length > 0) {
      setFiles((prev) => [...prev, ...valid].slice(0, 5));
      if (!title && valid[0]) setTitle(valid[0].name.replace(/\.[^/.]+$/, ""));
    }
  }, [title]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleUpload = async () => {
    if (files.length === 0 || !title || !category) { setError("请填写所有必填字段"); return; }
    setUploading(true); setError(""); setProgress(0); setStage("uploading");

    const formData = new FormData();
    formData.append("file", files[0]);
    formData.append("title", title);
    formData.append("category", category);
    formData.append("security_level", securityLevel);

    try {
      await uploadWithProgress("/documents/upload", formData, setProgress);
      setStage("indexing");
      showToast("success", `"${title}" 上传成功，正在构建索引`);
      setFiles([]); setTitle(""); setCategory(""); setSecurityLevel("internal");
      setStage("done");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
      setStage("idle");
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) { setFiles([]); setTitle(""); setCategory(""); setError(""); setStage("idle"); onClose(); }
  };

  return (
    <Modal open={open} onClose={handleClose} title="上传文档" size="lg">
      <div className="flex flex-col gap-5">
        {/* Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={handleDrop}
          onClick={() => !files.length && fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all ${
            dragOver ? "border-accent bg-accent-soft/30 scale-[1.02]" : "border-border hover:border-accent hover:bg-accent-soft/10"
          } ${files.length > 0 ? "cursor-default" : ""}`}
        >
          {files.length > 0 ? (
            <div className="w-full space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-surface-page rounded-lg px-4 py-2.5">
                  <FileText className="h-6 w-6 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{f.name}</p>
                    <p className="text-xs text-text-muted">{(f.size / 1024).toFixed(1)} KB</p>
                  </div>
                  {!uploading && (
                    <button onClick={(e) => { e.stopPropagation(); setFiles((p) => p.filter((_,j) => j !== i)); }} className="p-1 rounded-lg hover:bg-danger-soft text-text-muted hover:text-danger transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {files.length < 5 && !uploading && (
                <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="w-full rounded-lg border border-dashed border-border p-2 text-xs text-text-muted hover:border-accent hover:text-accent transition-colors">
                  + 添加更多文件
                </button>
              )}
            </div>
          ) : (
            <>
              <Upload className="mb-3 h-10 w-10 text-text-muted/40" />
              <p className="text-sm text-text-secondary">拖拽文件到此处，或点击选择</p>
              <p className="mt-1 text-xs text-text-muted">支持 PDF · DOCX · Markdown · TXT，最大 20MB</p>
            </>
          )}
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.md,.txt" onChange={(e) => addFiles(e.target.files)} className="hidden" multiple />
        </div>

        {/* Progress bar */}
        {stage !== "idle" && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-text-muted">
              <span>{stage === "uploading" ? "上传中" : stage === "indexing" ? "索引构建中..." : "完成"}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  stage === "done" ? "bg-success" : stage === "indexing" ? "bg-accent animate-pulse" : "bg-accent"
                }`}
                style={{ width: stage === "indexing" ? "100%" : `${progress}%` }}
              />
            </div>
            {stage === "indexing" && (
              <p className="text-xs text-text-muted flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                RAG 正在解析、清洗、分块、向量化...
              </p>
            )}
            {stage === "done" && (
              <p className="text-xs text-success flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" />索引构建完成
              </p>
            )}
          </div>
        )}

        {/* Form */}
        <Input label="文档标题" placeholder="输入文档标题" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">分类</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border bg-surface-page px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20">
            <option value="">选择分类</option>
            {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">安全等级</label>
          <div className="flex gap-2">
            {SECURITY_LEVELS.map((lvl) => (
              <label key={lvl.value} className={`flex cursor-pointer items-center rounded-lg border px-3 py-1.5 text-sm transition-all ${
                securityLevel === lvl.value ? "border-accent bg-accent-soft text-accent" : "border-border text-text-secondary hover:bg-surface-hover"}`}>
                <input type="radio" name="security_level" value={lvl.value} checked={securityLevel === lvl.value} onChange={(e) => setSecurityLevel(e.target.value)} className="sr-only" />
                {lvl.label}
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={uploading}>取消</Button>
          <Button onClick={handleUpload} loading={uploading} disabled={files.length === 0 || !title || !category}>
            {uploading ? "上传中..." : "上传并索引"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
