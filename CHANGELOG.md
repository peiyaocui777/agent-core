# Changelog

All notable changes to `@jarvis/agent-core` will be documented in this file.

## [8.0.0] - 2026-02-07

### Added
- **createJarvis()** — 一键启动函数，串联全部 24 个模块为统一运行时
- **真实 LLM 联调** — 硅基流动 DeepSeek-V3 端到端验证通过
- **GitHub Actions CI** — Node 18/20/22 矩阵测试 + 类型检查
- **CLI 新命令** — `jarvis-agent web`、`knowledge`、`desktop`

### Fixed
- `agent.handleMessage` → 正确调用 `agent.run()` + `llm.chat()`
- 知识库 RAG 上下文注入到 LLM 对话

## [7.0.0] - 2026-02-06

### Added
- **LLM Streaming** — 真实 SSE 流式输出 (`chatStream` / `completeStream`)
- **KnowledgeBase** — 本地知识库，文档导入/分块/TF-IDF 向量化/语义查询
- **NotificationCenter** — 6 种通知类型 + 5 默认规则 + 多渠道推送
- **ConversationManager** — 对话 CRUD/搜索/导出(JSON/MD/TXT)/置顶/归档
- **DesktopBuilder** — Tauri v2 桌面应用配置生成器

## [6.0.0] - 2026-02-05

### Added
- **VectorMemory** — TF-IDF 语义搜索 + 余弦相似度 + RAG 上下文注入
- **AutonomousPlanner** — Plan→Act→Observe→Reflect AI 自主决策引擎
- **WebChatServer** — 类 LobeChat 现代 Chat UI（深浅主题/SSE/响应式）
- **ConfigLoader** — YAML/JSON/.env 三级配置加载 + 校验 + 模板生成
- **Docker 部署** — Dockerfile + docker-compose.yml + .env.example

## [5.0.0] - 2026-02-04

### Added
- **BrowserPilot** — Playwright 浏览器自动化 Skill（10 个工具）
- **CronMaestro** — 自然语言→Cron 定时调度引擎（9 种模式）
- **EventBus** — 类型安全事件系统（30+ 事件 + 通配符 + 中间件）
- **PluginSDK** — 第三方 Skill 开发套件
- **TenantManager** — SaaS 多租户管理

## [4.0.0] - 2026-02-03

### Added
- **SafetyEngine** — 四层风控（敏感词/频率/平台规则/反封策略）
- **4 个新平台 Skill** — 抖音/B站/微博/知乎
- **AnalyticsEngine** — 跨平台数据分析 + SEO 评分
- **QualityEngine** — 7 维内容质量评分 + 原创检测

## [3.0.0] - 2026-02-02

### Added
- **Skills 系统** — 热加载运行时 + 5 个内置 Skill
- **MemoryStore** — JSON 持久化记忆系统
- **LLM Intent Engine** — Function Calling 意图识别
- **Telegram Bot** — grammy 框架，10 命令 + Inline Keyboard
- **MCP 协议** — Server/Client/Manager 完整实现
- **Multi-Agent** — 5 角色协作编排
- **Workflow Engine** — DAG 管道执行引擎
- **Marketplace** — Skill 搜索/安装/评分市场
- **Dashboard** — HTTP API + 暗色 Web UI
- **CLI** — `jarvis-agent` 命令行工具（14 命令）
