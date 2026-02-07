# Jarvis Agent

[![npm version](https://img.shields.io/npm/v/@jarvis/agent-core.svg?style=flat-square)](https://www.npmjs.com/package/@jarvis/agent-core)
[![license](https://img.shields.io/npm/l/@jarvis/agent-core.svg?style=flat-square)](https://github.com/xuyuyu/jarvis-agent/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@jarvis/agent-core.svg?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![CI](https://img.shields.io/github/actions/workflow/status/xuyuyu/jarvis-agent/ci.yml?style=flat-square&label=CI)](https://github.com/xuyuyu/jarvis-agent/actions)

**你的开源 AI 分身** — 类 OpenClaw 的个人 AI 助手，桌面/网页端自用。

> 24 模块 · 10 Skills · 向量记忆 · RAG · 自主决策 · 知识库 · Chat UI · MCP 协议 · 多平台发布

---

## 特性

- **一键启动** — `createJarvis()` 自动串联所有模块
- **Chat UI** — 类 LobeChat 的现代暗色界面，深浅主题，移动端响应式
- **向量记忆** — TF-IDF 语义搜索 + RAG 自动注入 LLM 上下文
- **知识库** — 导入文档（TXT/MD/JSON），自动分块向量化
- **自主决策** — Plan → Act → Observe → Reflect 循环
- **LLM Streaming** — 真实 SSE 流式输出到 Chat UI
- **10 个内置 Skill** — 内容采集/AI 写作/小红书/公众号/抖音/B站/微博/知乎/多平台/浏览器
- **MCP 协议** — 标准化 JSON-RPC 工具发现与执行
- **Multi-Agent** — 5 角色协作（写手/编辑/发布员/分析师/协调员）
- **通知中心** — 事件驱动，多渠道推送
- **对话管理** — 持久化/搜索/导出/置顶/归档
- **桌面端** — Tauri v2 一键生成，系统托盘 + 全局快捷键
- **Docker 部署** — `docker-compose up` 即用

---

## 快速开始

### 1. 安装

**方式 A：npm 安装（推荐）**

```bash
npm install @jarvis/agent-core
```

**方式 B：从源码安装**

```bash
git clone https://github.com/xuyuyu/jarvis-agent.git
cd jarvis-agent
npm install
npm run build
```

### 2. 配置

```bash
npx jarvis-agent init
# 编辑 jarvis.config.yaml，填入你的 API Key
```

### 3. 启动 Web Chat

```bash
npx jarvis-agent web
# 打开 http://localhost:3900
```

### 4. 或 CLI 模式

```bash
npx jarvis-agent chat
```

---

## 使用方式

### 代码方式

```typescript
import { createJarvis } from "@jarvis/agent-core";

const jarvis = await createJarvis({
  agent: {
    llm: { provider: "deepseek", apiKey: "sk-xxx" }
  },
});

// 对话（自动 RAG + 知识库 + 安全检查 + 记忆）
const reply = await jarvis.chat("帮我写一篇关于 AI 的小红书笔记");

// 启动 Web UI
await jarvis.startWeb();

// 知识库
jarvis.knowledge.addDocument("运营指南", "小红书标题不超过20字...");

// 向量记忆
jarvis.memory.remember("用户喜欢简洁风格", "preference");

// 通知
jarvis.notifications.success("发布成功", "小红书发布完成");
```

### CLI 方式

```bash
# Web Chat UI（推荐）
jarvis-agent web

# CLI 对话
jarvis-agent chat

# 执行指令
jarvis-agent run "采集今日热点并生成小红书笔记"

# 知识库管理
jarvis-agent knowledge add ./docs/guide.md
jarvis-agent knowledge list
jarvis-agent knowledge query "小红书怎么运营"

# Skills
jarvis-agent skills
jarvis-agent marketplace

# 其他
jarvis-agent status
jarvis-agent dashboard
jarvis-agent mcp-server
jarvis-agent desktop
```

### Docker

```bash
cp .env.example .env
# 编辑 .env 填入 API Key
docker-compose up -d
# 打开 http://localhost:3900
```

---

## 架构

```
┌───────────────────────────────────────────────────┐
│                   Web Chat UI                     │
│          (SSE Streaming / 深浅主题 / 响应式)        │
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────┼──────────────────────────┐
│                  Jarvis Runtime                    │
│  ┌─────────┐  ┌────────┴────────┐  ┌───────────┐ │
│  │Vector   │  │  Agent Core     │  │Knowledge  │ │
│  │Memory   │──│  (10 Skills,    │──│Base       │ │
│  │(RAG)    │  │   39 Tools)     │  │(RAG)      │ │
│  └─────────┘  └────────┬────────┘  └───────────┘ │
│  ┌─────────┐  ┌────────┴────────┐  ┌───────────┐ │
│  │Autonomous│  │LLM Client      │  │Conversation│ │
│  │Planner  │  │(Stream/DeepSeek │  │Manager    │ │
│  │(ReAct)  │  │ /OpenAI/Gemini) │  │           │ │
│  └─────────┘  └─────────────────┘  └───────────┘ │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │Notifi-  │  │Event    │  │Safety   │          │
│  │cation   │──│Bus      │──│Engine   │          │
│  │Center   │  │(30+类型) │  │(4层风控) │          │
│  └─────────┘  └─────────┘  └─────────┘          │
└───────────────────────────────────────────────────┘
                         │
    ┌──────────┬─────────┼─────────┬──────────┐
    │          │         │         │          │
┌───┴──┐ ┌───┴───┐ ┌───┴───┐ ┌──┴───┐ ┌───┴──┐
│小红书│ │公众号 │ │抖音  │ │B站  │ │微博  │
│知乎  │ │Telegram│ │CLI  │ │MCP  │ │浏览器│
└──────┘ └───────┘ └──────┘ └─────┘ └──────┘
```

---

## 模块清单

| 模块 | 说明 | 版本 |
|------|------|------|
| Agent Core | 10 Skills, 39 Tools, 意图识别 | v1 |
| Skills 系统 | 热加载, 自创建, 运行时 | v3 |
| Memory | JSON 持久化 + 向量语义搜索 | v6 |
| KnowledgeBase | 文档导入/分块/向量化/RAG | v7 |
| AutonomousPlanner | Plan→Act→Observe→Reflect | v6 |
| LLM Streaming | SSE 真实流式输出 | v7 |
| ConversationManager | CRUD/搜索/导出/标签 | v7 |
| NotificationCenter | 6 类型/5 规则/多渠道 | v7 |
| WebChatServer | 类 LobeChat 现代 UI | v6 |
| ConfigLoader | YAML/JSON/.env 三级配置 | v6 |
| MCP 协议 | Server + Client + Manager | v3 |
| Multi-Agent | 5 角色协作编排 | v3 |
| Workflow 引擎 | DAG 管道, 7 节点类型 | v3 |
| Marketplace | 搜索/安装/评分 | v3 |
| Dashboard | HTTP API + Web UI | v3 |
| SafetyEngine | 敏感词/频率/平台/反封 | v4 |
| AnalyticsEngine | 跨平台统计/SEO 评分 | v4 |
| QualityEngine | 7 维评分/原创检测 | v4 |
| EventBus | 30+ 类型安全事件 | v5 |
| CronMaestro | 自然语言定时调度 | v5 |
| PluginSDK | 第三方 Skill 开发 | v5 |
| TenantManager | SaaS 多租户 | v5 |
| DesktopBuilder | Tauri v2 桌面端 | v7 |
| Bootstrap | createJarvis() 一键启动 | v8 |

---

## 配置

### jarvis.config.yaml

```yaml
llm:
  provider: deepseek       # deepseek / openai / gemini / claude / ollama
  apiKey: ""               # 或使用 JARVIS_LLM_API_KEY 环境变量
  model: deepseek-chat

agent:
  name: Jarvis
  persona: assistant
  language: zh-CN

safety:
  level: moderate
  dailyPublishLimit: 30

server:
  dashboardPort: 3800

advanced:
  vectorMemoryEnabled: true
  logLevel: info
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `JARVIS_LLM_API_KEY` | LLM API Key |
| `JARVIS_LLM_PROVIDER` | Provider (deepseek/openai/gemini) |
| `JARVIS_TELEGRAM_TOKEN` | Telegram Bot Token |
| `JARVIS_DASHBOARD_PORT` | Dashboard 端口 |
| `JARVIS_SAFETY_LEVEL` | 安全等级 |

---

## 测试

```bash
npm test                   # 运行全部测试 (475+)
npm run test:v3            # Phase 3 测试
npm run test:v8            # Phase 7 测试
npm run test:v9            # Phase 8 测试
```

---

## 开发

```bash
git clone https://github.com/xuyuyu/jarvis-agent.git
cd jarvis-agent
npm install
npm run build              # 编译
npm run dev                # TypeScript 监视模式
npm run test               # 运行全部测试 (500+)
npm run test:llm           # 真实 LLM 联调测试
```

---

## License

MIT
