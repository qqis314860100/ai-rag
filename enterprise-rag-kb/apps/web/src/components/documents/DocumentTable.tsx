import { useState, useEffect, useCallback } from "react";
import { Upload, RefreshCw, Search } from "lucide-react";
import { api } from "../../services/api";
import type { Document, PaginatedResponse, ApiResponse } from "../../types";
import { Button, Input, Badge, Spinner, EmptyState, getBadgeLabel } from "../ui";
import UploadModal from "./UploadModal";

export default function DocumentTable() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const pageSize = 15;

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (keyword) params.set("keyword", keyword);
      const res = await api.get<ApiResponse<PaginatedResponse<Document>>>(
        `/documents?${params.toString()}`
      );
      setDocuments(res.data.items);
      setTotal(res.data.pagination.total);
      setTotalPages(res.data.pagination.total_pages);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleReindex = async (id: string) => {
    try {
      await api.post(`/documents/${id}/reindex`);
      fetchDocuments();
    } catch (err) {
      console.error("Failed to reindex:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("确认删除该文档？此操作不可撤销。")) return;
    try {
      await api.delete(`/documents/${id}`);
      fetchDocuments();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              placeholder="搜索文档标题..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" />
          上传文档
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          title="暂无文档"
          description="上传第一批产线知识文档后，即可开始构建知识库。"
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" />
              上传文档
            </Button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-primary-soft/50 text-left text-text-secondary">
                  <th className="px-4 py-3 font-medium">文档名称</th>
                  <th className="px-4 py-3 font-medium">分类</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">安全等级</th>
                  <th className="px-4 py-3 font-medium">Chunk</th>
                  <th className="px-4 py-3 font-medium">更新时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-primary-soft/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-text">{doc.title}</td>
                    <td className="px-4 py-3 text-text-secondary">{doc.category}</td>
                    <td className="px-4 py-3">
                      <Badge variant={doc.status === "active" ? "active" : doc.status}>
                        {getBadgeLabel(doc.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={doc.security_level}>
                        {getBadgeLabel(doc.security_level)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{doc.chunk_count}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {new Date(doc.updated_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReindex(doc.id)}
                          className="rounded p-1.5 text-text-muted hover:bg-primary-soft hover:text-accent transition-colors"
                          title="重建索引"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="rounded p-1.5 text-text-muted hover:bg-error-soft hover:text-error transition-colors"
                          title="删除"
                        >
                          <span className="text-xs font-medium">删除</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-text-secondary">
            <span>共 {total} 条文档</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="px-2">
                {page} / {totalPages || 1}
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => { setUploadOpen(false); fetchDocuments(); }}
      />
    </div>
  );
}
