# 领域术语表

产线与系统术语，供 Agent 与阅读者对齐概念。来源：docs/PRD.md 术语表 + 知识库文档。

## 产线/工艺

| 术语 | 说明 |
|------|------|
| 电芯 (Cell) | 电池最小单元 |
| 模组 (Module) | 电芯成组后的中间产品 |
| Pack | 模组+结构件+热管理组成的电池包 |
| CTP (Cell to Pack) | 电芯直接集成到 Pack，省去模组层级的技术 |
| Busbar | 电芯/模组间的导电连接排（如极柱 Busbar 激光焊接） |
| OCV (Open Circuit Voltage) | 开路电压，电芯分选与自放电检测的核心指标 |
| EOL 测试 (End of Line) | 下线测试，如模组 EOL、Pack EOL |
| 绝缘电阻 / 耐压 | 高压安全测试项 |
| CCD 视觉检测 | 机器视觉外观/位置检测（如极柱表面缺陷） |
| MES | 制造执行系统（生产追溯） |
| SOP | 标准作业程序 |
| 涂胶 / 堆叠 / 分选 | 电芯制造关键工序 |

## 系统/安全

| 术语 | 说明 |
|------|------|
| security_level | 文档安全等级：public / internal / confidential / restricted |
| index_status | 索引状态：pending / processing / ready / failed |
| chunk | 文档切片（默认 600 字符 / 120 重叠），检索与引用的最小单元 |
| top_k | 一次检索返回的片段数量（1-50，默认 5） |
| RAG | 检索增强生成（解析→分块→Embedding→检索→LLM） |
| SSE | Server-Sent Events，流式推送 |
| RBAC | 基于角色的访问控制（7 角色） |
| JWT | JSON Web Token（24h 有效，生产必须配置 JWT_SECRET） |
| X-API-Key | API 网关与 RAG 服务间的共享密钥（RAG_API_KEY） |
| fire-and-forget | 异步发起不等待结果（上传后索引） |
| fallback 模式 | Embedding 不可用时降级为 Hash 向量（检索质量下降） |
