# Review Gates

---

## 1. Build Gate

必须通过：

- 前端构建成功。
- Node API 启动成功。
- Python RAG 启动成功。
- 没有明显类型错误或语法错误。

验收命令示例：

```text
npm run build
npm run test
python -m pytest
```

---

## 2. Contract Gate

检查：

- API 是否符合 `enterprise-rag-kb-api-spec.md`。
- 响应是否统一 `{ data }` / `{ error }`。
- `/api/chat` 是否返回 `answer`、`sources`、`confidence`。
- `/api/search/debug` 是否返回 `results`、`score`、`prompt_preview`。

阻断项：

- 前端直接调用 DeepSeek。
- 前端直接访问 ChromaDB。
- Node 绕过 Python 自己拼 RAG。

---

## 3. RAG Gate

检查：

- chunk 包含 document_id、chunk_id、section_path。
- embedding 维度为 384。
- 检索默认过滤 `status = active`。
- 检索包含 `security_level` 权限过滤。
- 无检索结果时不编造答案。
- 答案 sources 可回溯到 chunk。

阻断项：

- 答案没有引用来源。
- 安全类问题给出高风险无约束操作。
- 文档中的 prompt injection 改变系统行为。

---

## 4. UI Gate

检查：

- UI 使用暖白背景、深石墨主色、金色点缀。
- Chat 页面有 SourcePanel。
- Documents 页面可查看索引状态。
- Debugger 页面可查看 score 和 chunk。
- 移动端不出现文字重叠。

阻断项：

- 问答页无法查看引用。
- 文档上传没有状态反馈。
- 检索调试页缺失 score。

---

## 5. Security Gate

检查：

- DeepSeek API Key 不进入前端 bundle。
- 日志不打印密钥。
- 文件上传限制类型和大小。
- 文档下载鉴权。
- 检索权限过滤生效。
- 审计日志记录上传、删除、问答、配置变更。

阻断项：

- 任意用户可访问 restricted 文档。
- API Key 明文返回到浏览器。
- 上传文件可被当作代码执行。

---

## 6. E2E Gate

端到端验收：

1. 启动 web、api、rag。
2. 上传一篇 Markdown 文档。
3. 文档状态变为 ready。
4. 提问命中文档内容。
5. 答案返回 sources。
6. 点击 sources 能查看原文片段。
7. Debugger 显示 topK、score、chunk。
8. 无依据问题明确说明无法确认。

通过标准：

```text
所有步骤完成，无 P0/P1 缺陷。
```

