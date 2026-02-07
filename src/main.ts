#!/usr/bin/env node
/**
 * Jarvis Agent — 主入口
 *
 * 用法：
 *   npx tsx src/main.ts                    # CLI 交互模式
 *   npx tsx src/main.ts --telegram         # Telegram Bot 模式
 *   npx tsx src/main.ts --mode cli         # 显式指定模式
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY   — DeepSeek LLM API Key
 *   GEMINI_API_KEY     — Gemini API Key
 *   OPENAI_API_KEY     — OpenAI API Key
 *   TELEGRAM_BOT_TOKEN — Telegram Bot Token
 *   TELEGRAM_USERS     — 允许的 Telegram 用户 ID（逗号分隔）
 *   XHS_API_URL        — 小红书 MCP 服务地址
 *   LLM_PROVIDER       — LLM Provider (deepseek/gemini/openai)
 */

import { createAgent } from "./index.js";
import { PersonaManager } from "./persona/persona.js";
import { CLIBridge } from "./bridges/cli.js";
import { TelegramBridge } from "./bridges/telegram.js";
import type { AgentConfig } from "./types.js";

// ==================== 配置解析 ====================

function loadConfig(): AgentConfig {
  // 自动检测 LLM Provider
  const provider = process.env.LLM_PROVIDER ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek" :
     process.env.GEMINI_API_KEY ? "gemini" :
     process.env.OPENAI_API_KEY ? "openai" : "deepseek");

  const apiKeyMap: Record<string, string | undefined> = {
    deepseek: process.env.DEEPSEEK_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };

  const config: AgentConfig = {
    xhsApiUrl: process.env.XHS_API_URL || "http://127.0.0.1:18060",
    trendApiUrl: process.env.TREND_API_URL || "http://127.0.0.1:3001",
    imgBedUrl: process.env.IMG_BED_URL,
  };

  const apiKey = apiKeyMap[provider];
  if (apiKey) {
    config.llm = {
      provider: provider as "deepseek" | "gemini" | "openai",
      apiKey,
      model: process.env.LLM_MODEL,
      baseUrl: process.env.LLM_BASE_URL,
    };
  }

  return config;
}

// ==================== Main ====================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes("--telegram") ? "telegram" :
               args.includes("--mode") ? args[args.indexOf("--mode") + 1] :
               "cli";

  console.log("🚀 Jarvis Agent 启动中...\n");

  // 加载配置
  const config = loadConfig();

  // 创建 Agent
  const agent = createAgent(config);
  await agent.initialize();

  // 创建 Persona
  const persona = new PersonaManager("jarvis");

  // 优雅退出
  const cleanup = async () => {
    console.log("\n正在关闭...");
    await agent.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // 根据模式启动
  switch (mode) {
    case "telegram": {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        console.error("❌ 请设置 TELEGRAM_BOT_TOKEN 环境变量");
        console.error("   从 @BotFather 获取 Token: https://t.me/BotFather");
        process.exit(1);
      }

      const allowedUsers = process.env.TELEGRAM_USERS
        ? process.env.TELEGRAM_USERS.split(",").map(Number)
        : undefined;

      const telegram = new TelegramBridge(agent, {
        token,
        allowedUsers,
        botName: persona.getCurrent().name,
        enableHeartbeat: true,
      });

      await telegram.start();
      break;
    }

    case "cli":
    default: {
      const cli = new CLIBridge(agent, persona);
      await cli.start();
      break;
    }
  }
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
