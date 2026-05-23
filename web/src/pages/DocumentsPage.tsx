import DocumentTable from "../components/documents/DocumentTable";

export default function DocumentsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-text">知识库管理</h1>
        <p className="mt-1 text-sm text-text-secondary">
          管理知识库文档，上传、筛选、重建索引
        </p>
      </div>
      <DocumentTable />
    </div>
  );
}
