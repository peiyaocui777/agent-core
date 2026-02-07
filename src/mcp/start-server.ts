#!/usr/bin/env tsx
/**
 * MCP Server 独立启动脚本
 *
 * 将 Jarvis Agent 作为标准 MCP Server 暴露给外部 AI 应用（Cursor/Claude Desktop 等）
 *
 * 用法：
 *   npx tsx src/mcp/start-server.ts
 *
 * 在 Cursor 的 mcp.json 中配置：
 *   {
 *     "jarvis-agent": {
 *       "command": "npx",
 *       "args": ["tsx", "src/mcp/start-server.ts"],
 *       "cwd": "/path/to/agent-core"
 *     }
 *   }
 */

import { AgentCore } from "../agent.js";
import { getAllBundledSkills } from "../skills/bundled/index.js";
import { McpServer } from "./server.js";
import type { AgentConfig } from "../types.js";

async function main() {
  // 从环境变量加载配置
  const config: AgentConfig = {
    xhsApiUrl: process.env.XHS_API_URL || "http://localhost:18060",
    wechatApiUrl: process.env.WECHAT_API_URL || "http://localhost:18061",
    llm: process.env.LLM_API_KEY ? {
      provider: (process.env.LLM_PROVIDER as "openai" | "deepseek" | "gemini") || "deepseek",
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
      baseUrl: process.env.LLM_BASE_URL,
    } : undefined,
  };

  // 创建并初始化 Agent
  const agent = new AgentCore(config);
  agent.registerSkills(getAllBundledSkills());
  await agent.initialize();

  console.error(`[MCP Server] Agent 初始化完成: ${agent.getAllTools().length} 个工具可用`);

  // 启动 MCP Server
  const server = new McpServer(agent);
  await server.start();
}

main().catch((err) => {
  console.error("[MCP Server] 启动失败:", err);
  process.exit(1);
});
