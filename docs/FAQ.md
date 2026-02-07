# 常见问题 FAQ

## 1. 平台代理（小红书/公众号等）需要单独部署吗？能否集成到一起？

**当前架构**：各平台代理（xiaohongshu-mcp、wenyan-mcp、social-auto-upload）是**独立进程**，通过 HTTP API 与 Jarvis Agent 通信。

**可以集成的方式**：

| 方式 | 说明 | 难度 |
|------|------|------|
| **Docker Compose 一体化** | 一个 `docker-compose.yml` 同时启动 Jarvis + 所有平台代理 | ✅ 推荐，已在 PLATFORM-GUIDE.md 提供模板 |
| **Monorepo 代码集成** | 把各代理代码放进同一仓库，统一构建 | 中，需要维护多语言（Go/Python/Node） |
| **嵌入到主进程** | 将代理逻辑用 Node 重写并内嵌 | 高，工作量大，不推荐 |

**推荐做法**：使用 Docker Compose 一体化部署，一个命令启动全部服务：

```bash
docker-compose -f docker-compose.yml -f docker-compose.platforms.yml up -d
```

详见 [docs/PLATFORM-GUIDE.md](./PLATFORM-GUIDE.md)。

---

## 2. Telegram 可以通过界面操作吗？

**当前**：Telegram 通过 `jarvis-agent start --telegram` 或 `npm run start:telegram` 命令行启动，**暂无 Web 界面** 来配置或控制。

**计划**：
- 在 Web Chat 或 Dashboard 增加「Telegram 状态」面板
- 支持在界面中填写 Bot Token、查看连接状态
- 一键启用/停用 Telegram 桥接

**临时方案**：在 `jarvis.config.yaml` 或 `.env` 中配置 `JARVIS_TELEGRAM_TOKEN`，然后命令行启动。

---

## 3. 如何扩展 Skill？

参考 [PluginSDK](../src/sdk/plugin-sdk.ts) 和内置 Skill 结构：

```typescript
import { createPlugin } from "jarvis-agent-core/sdk";

const mySkill = createPlugin({
  name: "my-skill",
  description: "我的自定义技能",
  tools: [
    {
      name: "my-tool",
      description: "工具描述",
      parameters: { query: { type: "string", required: true } },
      execute: async (params) => ({ success: true, data: params }),
    },
  ],
});
```

热门 Skill 参考：[awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills)、[skillcreatorai/Ai-Agent-Skills](https://github.com/skillcreatorai/Ai-Agent-Skills)。
