#!/usr/bin/env node
/**
 * Jarvis Agent CLI — 命令行安装器 & 管理工具
 *
 * 用法：
 *   jarvis-agent                    # 进入 CLI 交互模式
 *   jarvis-agent chat               # 进入对话模式
 *   jarvis-agent run "指令"          # 执行单条指令
 *   jarvis-agent skills             # 列出所有 Skill
 *   jarvis-agent skills search xxx  # 搜索 Skill
 *   jarvis-agent install <name>     # 安装 Marketplace Skill
 *   jarvis-agent uninstall <name>   # 卸载 Skill
 *   jarvis-agent marketplace        # 浏览 Marketplace
 *   jarvis-agent status             # 查看 Agent 状态
 *   jarvis-agent dashboard          # 启动 Web Dashboard
 *   jarvis-agent mcp-server         # 作为 MCP Server 运行
 *   jarvis-agent telegram           # 启动 Telegram Bot
 *   jarvis-agent init               # 初始化项目配置
 *   jarvis-agent version            # 版本信息
 */

import { AgentCore } from "../agent.js";
import { getAllBundledSkills } from "../skills/bundled/index.js";
import { PersonaManager } from "../persona/persona.js";
import { CLIBridge } from "../bridges/cli.js";
import { McpServer } from "../mcp/server.js";
import { SkillRegistry } from "../marketplace/registry.js";
import { getBuiltinPackages } from "../marketplace/builtin-packages.js";
import { DashboardServer } from "../dashboard/server.js";
import { Orchestrator } from "../multi-agent/orchestrator.js";
import { WorkflowEngine, getAllPresetPipelines } from "../workflow/index.js";
import type { AgentConfig } from "../types.js";

// ==================== 颜色辅助 ====================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(msg: string): void {
  console.log(msg);
}

function header(): void {
  log(`\n${C.cyan}${C.bold}  ╔══════════════════════════════════════╗`);
  log(`  ║        🤖 Jarvis Agent v7.0          ║`);
  log(`  ║  AI 分身 · 开源 · 桌面/网页 · 自用   ║`);
  log(`  ╚══════════════════════════════════════╝${C.reset}\n`);
}

// ==================== 配置加载 ====================

function loadConfig(): AgentConfig {
  return {
    xhsApiUrl: process.env.XHS_API_URL || "http://localhost:18060",
    wechatApiUrl: process.env.WECHAT_API_URL || "http://localhost:18061",
    llm: process.env.LLM_API_KEY
      ? {
          provider: (process.env.LLM_PROVIDER as "openai" | "deepseek" | "gemini") || "deepseek",
          apiKey: process.env.LLM_API_KEY,
          model: process.env.LLM_MODEL,
          baseUrl: process.env.LLM_BASE_URL,
        }
      : process.env.DEEPSEEK_API_KEY
        ? { provider: "deepseek", apiKey: process.env.DEEPSEEK_API_KEY }
        : undefined,
  };
}

async function createAgent(): Promise<AgentCore> {
  const config = loadConfig();
  const agent = new AgentCore(config);
  agent.registerSkills(getAllBundledSkills());
  await agent.initialize();
  return agent;
}

// ==================== 命令实现 ====================

async function cmdChat(): Promise<void> {
  header();
  const agent = await createAgent();
  const persona = new PersonaManager("jarvis");
  const cli = new CLIBridge(agent, persona);
  await cli.start();
}

async function cmdRun(instruction: string): Promise<void> {
  const agent = await createAgent();
  log(`${C.blue}▶ 执行: ${instruction}${C.reset}`);
  const task = await agent.run(instruction);
  log(`${C.green}✓ 状态: ${task.status}${C.reset}`);
  for (const step of task.steps) {
    const icon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : "○";
    const color = step.status === "completed" ? C.green : step.status === "failed" ? C.red : C.dim;
    log(`  ${color}${icon} ${step.toolName}: ${step.result?.success ? "成功" : step.result?.error || step.status}${C.reset}`);
  }
  await agent.shutdown();
}

async function cmdSkills(subCmd?: string, query?: string): Promise<void> {
  const agent = await createAgent();

  if (subCmd === "search" && query) {
    const results = agent.skills.searchSkills(query);
    log(`${C.blue}🔍 搜索 "${query}" — ${results.length} 个结果${C.reset}\n`);
    for (const s of results) {
      log(`  ${C.bold}${s.name}${C.reset} — ${s.description}`);
      log(`    ${C.dim}分类: ${s.category} | 工具: ${s.toolCount} | ${s.active ? "✅ 活跃" : "⏸ 停用"}${C.reset}`);
    }
  } else {
    const status = agent.skills.getStatus();
    log(`${C.blue}⚡ Skills (${status.length})${C.reset}\n`);
    for (const s of status) {
      const icon = s.active ? `${C.green}●` : `${C.red}○`;
      log(`  ${icon} ${C.bold}${s.name}${C.reset} — ${s.description}`);
      log(`    ${C.dim}分类: ${s.category} | 来源: ${s.source} | 工具: ${s.tools.join(", ")}${C.reset}`);
    }
  }
  await agent.shutdown();
}

async function cmdMarketplace(query?: string): Promise<void> {
  const registry = new SkillRegistry();
  await registry.load();

  // 自动注册内置包（首次）
  const existing = registry.listAll();
  if (existing.length === 0) {
    for (const pkg of getBuiltinPackages()) {
      await registry.publish(pkg);
    }
  }

  const result = registry.search({ query, sortBy: "downloads" });
  log(`${C.blue}🏪 Skills Marketplace (${result.total} 个包)${C.reset}\n`);

  for (const pkg of result.packages) {
    log(`  ${C.bold}${pkg.displayName}${C.reset} ${C.dim}${pkg.name}@${pkg.version}${C.reset}`);
    log(`    ${pkg.description}`);
    log(`    ${C.yellow}⭐ ${pkg.rating.average}${C.reset} (${pkg.rating.count}) | ⬇ ${pkg.downloads.total} | ${C.dim}${pkg.tags.join(", ")}${C.reset}`);
    log("");
  }

  const stats = registry.getStats();
  log(`${C.dim}总计: ${stats.totalPackages} 包 | ${stats.totalDownloads} 次下载${C.reset}`);
}

async function cmdInstall(packageName: string): Promise<void> {
  const registry = new SkillRegistry();
  await registry.load();

  // 自动注册内置包
  if (registry.listAll().length === 0) {
    for (const pkg of getBuiltinPackages()) {
      await registry.publish(pkg);
    }
  }

  log(`${C.blue}📦 安装: ${packageName}${C.reset}`);
  const result = await registry.install(packageName);

  if (result.success) {
    log(`${C.green}✓ 安装成功: ${result.packageName}@${result.version}${C.reset}`);
    log(`  路径: ${result.installedPath}`);
  } else {
    log(`${C.red}✗ 安装失败: ${result.error}${C.reset}`);
  }
}

async function cmdUninstall(packageName: string): Promise<void> {
  const registry = new SkillRegistry();
  await registry.load();

  log(`${C.yellow}🗑 卸载: ${packageName}${C.reset}`);
  const ok = await registry.uninstall(packageName);
  log(ok ? `${C.green}✓ 已卸载${C.reset}` : `${C.red}✗ 卸载失败${C.reset}`);
}

async function cmdStatus(): Promise<void> {
  const agent = await createAgent();
  const status = agent.getStatus();

  log(`${C.blue}📊 Agent 状态${C.reset}\n`);
  log(`  Skills:   ${C.bold}${status.skills.active}/${status.skills.total}${C.reset} 已激活`);
  log(`  Tools:    ${C.bold}${status.tools}${C.reset} 个`);
  log(`  Memory:   ${C.bold}${status.memory.memories}${C.reset} 条记忆, ${C.bold}${status.memory.publishHistory}${C.reset} 条发布`);
  log(`  Tasks:    ${C.bold}${status.tasks}${C.reset} 个`);

  await agent.shutdown();
}

async function cmdDashboard(): Promise<void> {
  header();
  const agent = await createAgent();
  const registry = new SkillRegistry();
  await registry.load();

  // 自动注册内置包
  if (registry.listAll().length === 0) {
    for (const pkg of getBuiltinPackages()) {
      await registry.publish(pkg);
    }
  }

  registry.bindAgent(agent);

  const orchestrator = new Orchestrator(agent);
  const workflow = new WorkflowEngine(agent);
  for (const p of getAllPresetPipelines()) {
    workflow.register(p);
  }

  const dashboard = new DashboardServer(agent, { port: 3800 }, { registry, orchestrator, workflow });
  await dashboard.start();

  log(`${C.green}✓ Dashboard 已启动: http://127.0.0.1:3800${C.reset}`);
  log(`${C.dim}  按 Ctrl+C 退出${C.reset}`);
}

async function cmdMcpServer(): Promise<void> {
  const agent = await createAgent();
  const server = new McpServer(agent);
  await server.start();
}

async function cmdInit(): Promise<void> {
  const fs = await import("fs");
  const { ConfigLoader } = await import("../config/loader.js");

  // 生成 YAML 配置
  if (!fs.existsSync("jarvis.config.yaml")) {
    fs.writeFileSync("jarvis.config.yaml", ConfigLoader.generateYamlTemplate(), "utf-8");
    log(`${C.green}✓ 配置文件: jarvis.config.yaml${C.reset}`);
  } else {
    log(`${C.yellow}⚠ jarvis.config.yaml 已存在，跳过${C.reset}`);
  }

  // 生成 .env
  if (!fs.existsSync(".env") && !fs.existsSync(".env.example")) {
    fs.writeFileSync(".env.example", ConfigLoader.generateEnvTemplate(), "utf-8");
    log(`${C.green}✓ 环境变量模板: .env.example${C.reset}`);
  }

  // 创建 data 目录
  if (!fs.existsSync("data")) {
    fs.mkdirSync("data", { recursive: true });
    log(`${C.green}✓ 数据目录: data/${C.reset}`);
  }

  log(`\n${C.cyan}接下来:${C.reset}`);
  log(`  1. 编辑 ${C.bold}jarvis.config.yaml${C.reset} 填入 API Key`);
  log(`  2. 运行 ${C.bold}jarvis-agent web${C.reset} 启动 Chat UI`);
  log(`  3. 或运行 ${C.bold}jarvis-agent chat${C.reset} 进入 CLI 模式\n`);
}

async function cmdWeb(): Promise<void> {
  header();
  const { createJarvis } = await import("../bootstrap.js");

  log(`${C.dim}  正在加载所有模块...${C.reset}`);
  const jarvis = await createJarvis({ autoStartWeb: false });

  // 同时启动 Dashboard + WebChat
  await jarvis.startWeb();

  const status = jarvis.getFullStatus();
  log(`\n${C.green}✓ Jarvis AI 已启动${C.reset}`);
  log(`  ${C.cyan}Web Chat:${C.reset}  http://127.0.0.1:3900`);
  log(`  ${C.cyan}Skills:${C.reset}    ${status.agent.skills} 个`);
  log(`  ${C.cyan}Tools:${C.reset}     ${status.agent.tools} 个`);
  log(`  ${C.cyan}记忆:${C.reset}      ${status.memory.entries} 条`);
  log(`  ${C.cyan}知识库:${C.reset}    ${status.knowledge.documents} 文档, ${status.knowledge.chunks} 块`);
  log(`  ${C.cyan}对话:${C.reset}      ${status.conversations.total} 个`);
  log(`\n${C.dim}  按 Ctrl+C 退出${C.reset}\n`);
}

async function cmdKnowledge(subCmd?: string, arg?: string): Promise<void> {
  const { KnowledgeBase } = await import("../knowledge/base.js");
  const kb = new KnowledgeBase({ dataPath: "./data/knowledge.json" });

  if (subCmd === "add" && arg) {
    const fs = await import("fs");
    if (fs.existsSync(arg)) {
      const doc = kb.addFromFile(arg);
      if (doc) {
        log(`${C.green}✓ 已导入: ${doc.title} (${doc.chunks.length} 块)${C.reset}`);
      } else {
        log(`${C.red}✗ 导入失败${C.reset}`);
      }
    } else {
      log(`${C.red}✗ 文件不存在: ${arg}${C.reset}`);
    }
  } else if (subCmd === "list") {
    const docs = kb.listDocuments();
    log(`${C.blue}📚 知识库 (${docs.length} 文档)${C.reset}\n`);
    for (const d of docs) {
      log(`  ${C.bold}${d.title}${C.reset}`);
      log(`    ${C.dim}${d.wordCount} 字 | ${d.chunkCount} 块 | ${d.createdAt}${C.reset}`);
      if (d.tags?.length) log(`    ${C.dim}标签: ${d.tags.join(", ")}${C.reset}`);
    }
    log(`\n${C.dim}总计: ${kb.getStatus().totalWords} 字, ${kb.getStatus().totalChunks} 块${C.reset}`);
  } else if (subCmd === "query" && arg) {
    const results = kb.query(arg, 5);
    log(`${C.blue}🔍 查询: "${arg}" — ${results.length} 个结果${C.reset}\n`);
    for (const r of results) {
      log(`  ${C.green}[${(r.similarity * 100).toFixed(1)}%]${C.reset} ${C.bold}${r.docTitle}${C.reset}`);
      log(`    ${C.dim}${r.chunk.slice(0, 150)}...${C.reset}\n`);
    }
  } else {
    log(`${C.bold}知识库命令:${C.reset}`);
    log(`  ${C.cyan}knowledge list${C.reset}              列出所有文档`);
    log(`  ${C.cyan}knowledge add${C.reset} <文件路径>      导入文档`);
    log(`  ${C.cyan}knowledge query${C.reset} <问题>        语义查询\n`);
  }
}

async function cmdDesktop(): Promise<void> {
  const { DesktopBuilder } = await import("../desktop/tauri-config.js");
  const builder = new DesktopBuilder();
  const result = builder.generateProject("./desktop");
  log(`${C.green}✓ 桌面端项目已生成${C.reset}`);
  log(result.instructions);
}

function cmdVersion(): void {
  log(`${C.bold}Jarvis Agent${C.reset} v7.0.0`);
  log(`${C.dim}Node.js ${process.version}${C.reset}`);
}

function cmdHelp(): void {
  header();
  log(`${C.bold}用法:${C.reset} jarvis-agent <command> [options]\n`);
  log(`${C.bold}核心命令:${C.reset}`);
  log(`  ${C.cyan}web${C.reset}                     启动 Web Chat UI (推荐)`);
  log(`  ${C.cyan}chat${C.reset}                    进入 CLI 交互模式`);
  log(`  ${C.cyan}run${C.reset} <指令>               执行单条自然语言指令`);
  log(`  ${C.cyan}init${C.reset}                    初始化项目配置`);
  log(`\n${C.bold}知识库:${C.reset}`);
  log(`  ${C.cyan}knowledge list${C.reset}           列出文档`);
  log(`  ${C.cyan}knowledge add${C.reset} <文件>      导入文档到知识库`);
  log(`  ${C.cyan}knowledge query${C.reset} <问题>    语义查询`);
  log(`\n${C.bold}Skills:${C.reset}`);
  log(`  ${C.cyan}skills${C.reset}                  列出所有 Skill`);
  log(`  ${C.cyan}skills search${C.reset} <关键词>    搜索 Skill`);
  log(`  ${C.cyan}marketplace${C.reset} [关键词]      浏览 Marketplace`);
  log(`  ${C.cyan}install${C.reset} <包名>           安装 Skill`);
  log(`  ${C.cyan}uninstall${C.reset} <包名>         卸载 Skill`);
  log(`\n${C.bold}服务:${C.reset}`);
  log(`  ${C.cyan}dashboard${C.reset}               启动 Dashboard (端口 3800)`);
  log(`  ${C.cyan}mcp-server${C.reset}              作为 MCP Server 运行`);
  log(`  ${C.cyan}telegram${C.reset}                启动 Telegram Bot`);
  log(`  ${C.cyan}desktop${C.reset}                 生成桌面端 (Tauri) 项目`);
  log(`  ${C.cyan}status${C.reset}                  查看 Agent 状态`);
  log(`  ${C.cyan}version${C.reset}                 版本信息`);
  log(`\n${C.bold}环境变量:${C.reset}`);
  log(`  ${C.dim}JARVIS_LLM_API_KEY   LLM API Key`);
  log(`  JARVIS_LLM_PROVIDER  LLM Provider (deepseek/openai/gemini)`);
  log(`  JARVIS_TELEGRAM_TOKEN  Telegram Bot Token${C.reset}\n`);
}

// ==================== 主入口 ====================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0]?.toLowerCase() || "chat";

  try {
    switch (cmd) {
      case "web":
        await cmdWeb();
        break;
      case "chat":
      case "interactive":
        await cmdChat();
        break;
      case "run":
        if (!args[1]) {
          log(`${C.red}✗ 请提供指令，如: jarvis-agent run "写一篇健身文章"${C.reset}`);
          process.exit(1);
        }
        await cmdRun(args.slice(1).join(" "));
        break;
      case "knowledge":
      case "kb":
        await cmdKnowledge(args[1], args.slice(2).join(" ") || undefined);
        break;
      case "desktop":
        await cmdDesktop();
        break;
      case "skills":
        await cmdSkills(args[1], args[2]);
        break;
      case "marketplace":
      case "market":
        await cmdMarketplace(args[1]);
        break;
      case "install":
        if (!args[1]) {
          log(`${C.red}✗ 请提供包名，如: jarvis-agent install @jarvis/skill-weather${C.reset}`);
          process.exit(1);
        }
        await cmdInstall(args[1]);
        break;
      case "uninstall":
        if (!args[1]) {
          log(`${C.red}✗ 请提供包名${C.reset}`);
          process.exit(1);
        }
        await cmdUninstall(args[1]);
        break;
      case "status":
        await cmdStatus();
        break;
      case "dashboard":
        await cmdDashboard();
        break;
      case "mcp-server":
      case "mcp":
        await cmdMcpServer();
        break;
      case "init":
        await cmdInit();
        break;
      case "version":
      case "-v":
      case "--version":
        cmdVersion();
        break;
      case "help":
      case "-h":
      case "--help":
        cmdHelp();
        break;
      default:
        log(`${C.red}✗ 未知命令: ${cmd}${C.reset}`);
        cmdHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`${C.red}错误:${C.reset}`, error);
    process.exit(1);
  }
}

main();
