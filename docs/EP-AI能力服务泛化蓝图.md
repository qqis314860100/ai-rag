# EP AI 能力服务泛化蓝图（ai-rag 侧执行）

> 日期：2026-09-09　执行方：ai-rag 仓新会话（自包含，勿依赖 ep 会话上下文）
> 关联：ep 仓 `/Users/tomtong/Software/js/ep/docs/research/2026-09-09-ai-rag-generalization-plan.md`（两仓契约基准，本文件为可执行版本）
> 目标：把本 rag 能力服务泛化为 ep AI 一期可调用的通用能力服务；**默认行为保持电池语料现状不变**（回归要求）。

## 背景：谁在调用、契约长什么样

ep 后端已实现 `AiCapabilityClient`（dev 用 Fake，local/oceanbase 用 HTTP 实现），它按以下契约调用本服务：

| ep 端点调用（HttpAiCapabilityClient） | ep 请求体要点 |
| --- | --- |
| `POST {base}/rag/chat/stream` | `{namespace, scopes:[{platformFamily,platformVariant,productLine,base,productionLine,processSection}], history:[{role,content}], question}`；SSE 事件序 `meta/delta/citations/done/error`（citations refs 含 docId/location/excerpt/inScope） |
| `POST {base}/rag/documents/ingest` | `{namespace, targetType, targetId, title, scopes}`（注：暂不含文件字节，运输方案联调期定） |
| `POST {base}/rag/extract` | 同 ingest 形态；响应 `{name,description,assetTypeCode,tags[],summary,categoryCode,scopeHints[],evidence[],confidence}`（与 ep `ExtractionResult` 逐字段对齐；空字段用 `""`/`[]`） |

ep 侧发送鉴权头 `X-Service-Key: <ai.capability.api-key>`；请求只携带 namespace 与 scope 过滤，**不携带用户身份**。

## 已核实的契约漂移（对照本仓现状，2026-09-09 勘察）

1. 鉴权：本仓 `rag/app/api/routes.py::verify_api_key` 读 `X-API-Key`；ep 发 `X-Service-Key`。→ 统一。
2. 语料命名空间：本仓单 collection（电池语料，collection 选择见 retrieval/vector_store）；ep 用 namespace 隔离（新增 `ep-docs`，电池保留）。
3. 检索范围过滤：本仓 /search 与 /chat 无 scopes（base/产品线等维度）过滤；ep 会随请求下发 scopes 列表（空=不限）。
4. 抽取端点：本仓无 `/rag/extract`（有知识卡/缺口等抽取类能力可参考 prompts 风格）。

## 执行清单（按序；每项在 ai-rag 仓单独小步、遵守 EXECUTION_RULES）

1. **配置**：`rag/app/core/config.py` 增加命名空间相关读取（默认值保持电池语料现 collection），`.env.example` 补注释项。
2. **鉴权头兼容**：`verify_api_key` 同时接受 `X-Service-Key` 与 `X-API-Key`（迁移期兼容，后续只保留其一）；health 测试更新。
3. **namespace 隔离**：`retrieval/vector_store` 支持按 namespace 选择 collection/前缀；chat/search/ingest 请求可带 `namespace`，缺省回退电池默认。电池语料默认路径行为不变。
4. **scopes 过滤**：chat/search 请求体新增 `scopes`（对象数组，维度见上表；空数组=不过滤）→ 检索 metadata 过滤（base/productLine 等与 Chroma metadata 对齐的键）。
5. **/extract**：新增路由（复用解析→切分→抽取，LLM 抽取提示词参考现有知识卡/术语类 prompts），响应 schema 与上表逐字段对齐；纳入现有 usage_guard/拒答纪律；接 API key 校验。
6. **契约自测**：本仓按现有 pytest 先例补测试：鉴权头兼容、namespace 默认回退、scopes 过滤、/extract 字段契约；`pnpm run verify`/`check:rag`/ruff 全绿。
7. **联调契约样本**（可选，帮助 ep 侧联调）：在 `rag/tests` 留一个 ep 形态请求的样例 fixture。

## 验收标准

- 电池语料全部现有端点/UI 行为不变（默认 namespace 路径回归绿）。
- ep 契约三条链路（chat/stream、documents/ingest、extract）与上表逐字段匹配（含空字段语义）。
- 鉴权：带 `X-Service-Key` 可过；未带（且已配置 key）401。
- 提交：单服务单 commit、中文 Conventional Commit（如 `feat(rag): 支持多语料命名空间与 scopes 过滤`）。

## 完成后回传

联调前在 ai-rag 仓给出：改动 commit 摘要 + 本服务冒烟（uvicorn 起服务，curl 三条链路按契约字段验收），再通知 ep 侧把 `ai.capability` 指向真实地址做端到端冒烟。
