# Contributing to Jarvis Agent

感谢你对 Jarvis Agent 的关注！欢迎贡献代码、文档或建议。

## 开发环境

```bash
# 克隆仓库
git clone https://github.com/jarvis-agent/agent-core.git
cd agent-core

# 安装依赖
npm install

# 运行测试
npm test

# 启动 CLI
npm start

# 启动 Dashboard
npm run start:dashboard
```

## 目录结构

```
src/
├── agent.ts              # Agent 核心
├── skills/               # Skills 系统
├── memory/               # Memory 持久化
├── intent/               # LLM 意图引擎
├── mcp/                  # MCP 协议
├── multi-agent/          # Multi-Agent 协作
├── workflow/             # Workflow 管道
├── marketplace/          # Skills 市场
├── dashboard/            # Web Dashboard
├── cli/                  # CLI 工具
├── bridges/              # 通讯桥接
├── persona/              # 人格系统
├── providers/            # LLM Provider
└── tools/                # 底层工具实现
```

## 贡献 Skill

创建新的 Skill 非常简单：

```typescript
import { defineSkill } from "@jarvis/agent-core";

export default defineSkill({
  meta: {
    name: "my-awesome-skill",
    version: "1.0.0",
    description: "我的技能",
    category: "content",
    triggers: ["我的技能"],
  },
  setup(config) {
    return [{
      name: "my-tool",
      description: "我的工具",
      category: "workflow",
      parameters: {},
      execute: async (params) => {
        return { success: true, data: "Hello from my skill!" };
      },
    }];
  },
});
```

## Pull Request 规范

1. Fork 仓库并创建分支
2. 确保测试通过 (`npm test`)
3. 遵循现有代码风格
4. 提交清晰的 PR 描述

## Issue 规范

- Bug 报告请提供：环境信息、复现步骤、预期行为
- Feature 请求请描述：使用场景、期望的 API

## License

MIT License
