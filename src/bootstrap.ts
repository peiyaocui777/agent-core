/**
 * createJarvis() — 一键启动 Jarvis Agent 完整运行时
 *
 * 串联所有模块为一个统一的 AI 分身实例：
 *   Agent Core → VectorMemory → KnowledgeBase → AutonomousPlanner
 *   → ConversationManager → NotificationCenter → EventBus
 *   → WebChatServer → DashboardServer → SafetyEngine
 *
 * 用法：
 * ```ts
 * const jarvis = await createJarvis();
 * // 或自定义配置
 * const jarvis = await createJarvis({ web: { port: 3900 } });
 * ```
 */

import { AgentCore } from "./agent.js";
import { getAllBundledSkills } from "./skills/bundled/index.js";
import { VectorMemory } from "./memory/vector-store.js";
import { KnowledgeBase } from "./knowledge/base.js";
import { AutonomousPlanner } from "./autonomous/planner.js";
import { ConversationManager } from "./conversation/manager.js";
import { NotificationCenter } from "./notification/center.js";
import { EventBus } from "./events/bus.js";
import { SafetyEngine } from "./safety/engine.js";
import { AnalyticsEngine } from "./analytics/engine.js";
import { QualityEngine } from "./quality/engine.js";
import { CronMaestro } from "./scheduler/cron-maestro.js";
import { WebChatServer } from "./web/chat-server.js";
import { ConfigLoader } from "./config/loader.js";
import { createLLMClient, LLMClient } from "./providers/llm.js";
import type { AgentConfig } from "./types.js";

// ==================== 类型 ====================

export interface JarvisInstance {
  /** Agent 核心 */
  agent: AgentCore;
  /** 向量记忆 */
  memory: VectorMemory;
  /** 知识库 */
  knowledge: KnowledgeBase;
  /** 自主决策 */
  planner: AutonomousPlanner;
  /** 对话管理 */
  conversations: ConversationManager;
  /** 通知中心 */
  notifications: NotificationCenter;
  /** 事件总线 */
  events: EventBus;
  /** 风控系统 */
  safety: SafetyEngine;
  /** 数据分析 */
  analytics: AnalyticsEngine;
  /** 质量引擎 */
  quality: QualityEngine;
  /** 定时调度 */
  scheduler: CronMaestro;
  /** Web Chat 服务 */
  web: WebChatServer;
  /** LLM 客户端 */
  llm: LLMClient | null;

  /** 启动 Web 服务 */
  startWeb(): Promise<void>;
  /** 关闭所有服务 */
  shutdown(): Promise<void>;
  /** 发消息（带 RAG + 知识库 + 安全检查 + 对话记录） */
  chat(message: string, conversationId?: string): Promise<string>;
  /** 获取全局状态 */
  getFullStatus(): JarvisStatus;
}

export interface JarvisStatus {
  version: string;
  uptime: number;
  agent: { skills: number; tools: number };
  memory: { entries: number; vocabulary: number };
  knowledge: { documents: number; chunks: number };
  conversations: { total: number; messages: number };
  notifications: { unread: number };
  scheduler: { tasks: number };
}

export interface JarvisOptions {
  /** Agent 配置 */
  agent?: AgentConfig;
  /** 数据目录 */
  dataDir?: string;
  /** Web 配置 */
  web?: { port?: number; host?: string; title?: string };
  /** 自动启动 Web */
  autoStartWeb?: boolean;
  /** 安全等级 */
  safetyLevel?: "strict" | "moderate" | "loose";
}

// ==================== 工厂函数 ====================

export async function createJarvis(options?: JarvisOptions): Promise<JarvisInstance> {
  const startTime = Date.now();

  // 1. 加载配置
  const configLoader = new ConfigLoader();
  const fileConfig = configLoader.load();

  const dataDir = options?.dataDir || fileConfig.agent?.memoryPath || "./data";

  // 合并 Agent 配置
  const agentConfig: AgentConfig = {
    name: (fileConfig.agent as Record<string, unknown>)?.name as string || "Jarvis",
    ...options?.agent,
  };

  // 如果配置文件有 LLM 配置，合并
  if (fileConfig.llm?.apiKey && !agentConfig.llm) {
    agentConfig.llm = {
      provider: fileConfig.llm.provider as "deepseek" | "openai" | "gemini",
      apiKey: fileConfig.llm.apiKey as string,
      model: fileConfig.llm.model as string | undefined,
      baseUrl: fileConfig.llm.baseUrl as string | undefined,
    };
  }

  // 2. 创建 Agent 核心
  const agent = new AgentCore(agentConfig);
  agent.registerSkills(getAllBundledSkills());
  await agent.initialize();

  // 3. LLM Client
  const llm = createLLMClient(agentConfig);

  // 4. 向量记忆
  const memory = new VectorMemory({
    dataPath: `${dataDir}/vector-memory.json`,
  });

  // 5. 知识库
  const knowledge = new KnowledgeBase({
    dataPath: `${dataDir}/knowledge.json`,
  });

  // 6. 自主决策
  const planner = new AutonomousPlanner();
  if (llm) {
    planner.setLLM((prompt) => llm.complete(prompt));
  }
  // 注册 Agent 的工具
  const allTools = agent.skills.getStatus().flatMap((s) => s.tools.map((t) => ({ name: t, description: `${s.name} 的工具` })));
  planner.registerTools(allTools);
  planner.setToolExecutor(async (name, params) => {
    try {
      const result = await agent.executeTool(name, params);
      return { success: result?.success ?? true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 7. 对话管理
  const conversations = new ConversationManager({
    dataPath: `${dataDir}/conversations.json`,
  });

  // 8. 通知中心
  const notifications = new NotificationCenter({
    dataPath: `${dataDir}/notifications.json`,
  });

  // 9. 事件总线
  const events = new EventBus();

  // 把事件总线连接到通知中心
  events.on("publish:success", (data) => {
    notifications.triggerByEvent("publish:success", data as Record<string, unknown>);
  });
  events.on("publish:error", (data) => {
    notifications.triggerByEvent("publish:error", data as Record<string, unknown>);
  });
  events.on("task:completed", (data) => {
    notifications.triggerByEvent("task:completed", data as Record<string, unknown>);
  });
  events.on("safety:blocked", (data) => {
    notifications.triggerByEvent("safety:blocked", data as Record<string, unknown>);
  });

  // 10. 风控
  const safety = new SafetyEngine({
    level: options?.safetyLevel || (fileConfig.safety?.level as "strict" | "moderate" | "loose") || "moderate",
  });

  // 11. 数据分析
  const analytics = new AnalyticsEngine({
    dataPath: `${dataDir}/analytics.json`,
  });

  // 12. 质量引擎
  const quality = new QualityEngine();

  // 13. 定时调度
  const scheduler = new CronMaestro({
    dataPath: `${dataDir}/scheduler.json`,
  });

  // 14. Web Chat 服务
  const web = new WebChatServer(
    agent,
    {
      port: options?.web?.port || (fileConfig.server?.dashboardPort as number) || 3900,
      host: options?.web?.host || "0.0.0.0",
      title: options?.web?.title || (fileConfig.agent as Record<string, unknown>)?.name as string || "Jarvis AI",
    },
    {
      vectorMemory: memory,
      planner,
      knowledgeBase: knowledge,
      notifications,
      convManager: conversations,
      llmClient: llm || undefined,
    }
  );

  // ==================== 统一 chat 方法 ====================

  async function chat(message: string, conversationId = "default"): Promise<string> {
    // 确保对话存在
    if (!conversations.getConversation(conversationId)) {
      conversations.createConversation(undefined, []);
      // 用返回的 id
      const allConvs = conversations.listConversations();
      if (allConvs.length > 0) {
        conversationId = allConvs[0].id;
      }
    }

    // 保存用户消息
    conversations.addMessage(conversationId, "user", message);

    // RAG 上下文
    let context = "";
    const ragPrompt = memory.buildRAGPrompt(message);
    if (ragPrompt) context += ragPrompt;

    const kbContext = knowledge.buildContext(message);
    if (kbContext) context += "\n## 知识库参考\n" + kbContext + "\n---\n";

    // 安全检查
    const safetyCheck = safety.checkContent(message);
    if (!safetyCheck.passed && safetyCheck.action === "block") {
      const blockMsg = `内容未通过安全检查: ${safetyCheck.violations.map((v) => v.description).join(", ")}`;
      events.emit("safety:blocked", { platform: "system", reason: blockMsg, riskScore: 100 });
      conversations.addMessage(conversationId, "assistant", blockMsg);
      return blockMsg;
    }

    // 调用 LLM 或 Agent
    let reply: string;
    try {
      if (llm) {
        // 有 LLM：构建对话上下文，直接调用 LLM
        const systemPrompt = `你是 ${agentConfig.name || "Jarvis"}，一个强大的 AI 分身助手。请用中文回复。\n${context}`;
        const historyMessages = conversations.getConversation(conversationId)?.messages
          .slice(-10) // 最近 10 条对话上下文
          .map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })) || [];

        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...historyMessages.slice(0, -1), // 排除刚加的 user 消息（避免重复）
          { role: "user" as const, content: message },
        ];

        const response = await llm.chat(messages, { maxTokens: 2048 });
        reply = response.content;
      } else {
        // 无 LLM：走 Agent 工具执行链路
        const task = await agent.run(context + message);
        if (task.status === "completed" && task.steps.length === 0) {
          // 闲聊
          reply = agent.memory.getRecentMessages(1)[0]?.content || "好的，有什么可以帮你的？";
        } else if (task.status === "completed") {
          reply = `已完成: ${task.steps.map(s => s.toolName).join(" → ")}`;
        } else {
          reply = `任务执行状态: ${task.status}`;
        }
      }
    } catch (error) {
      reply = `执行出错: ${error instanceof Error ? error.message : String(error)}`;
    }

    // 保存回复
    conversations.addMessage(conversationId, "assistant", reply);

    // 记忆
    memory.rememberConversation(message, reply);

    return reply;
  }

  // ==================== 启动 Web ====================

  async function startWeb(): Promise<void> {
    await web.start();
  }

  // ==================== 关闭 ====================

  async function shutdown(): Promise<void> {
    await web.stop();
    scheduler.stop();
    await agent.shutdown();
  }

  // ==================== 状态 ====================

  function getFullStatus(): JarvisStatus {
    const agentStatus = agent.getStatus();
    const memStatus = memory.getStatus();
    const kbStatus = knowledge.getStatus();
    const convStatus = conversations.getStatus();

    return {
      version: "7.0.0",
      uptime: (Date.now() - startTime) / 1000,
      agent: { skills: agentStatus.skills.active, tools: agentStatus.tools },
      memory: { entries: memStatus.totalEntries, vocabulary: memStatus.vocabularySize },
      knowledge: { documents: kbStatus.totalDocuments, chunks: kbStatus.totalChunks },
      conversations: { total: convStatus.totalConversations, messages: convStatus.totalMessages },
      notifications: { unread: notifications.getUnreadCount() },
      scheduler: { tasks: 0 },
    };
  }

  // ==================== 自动启动 ====================

  if (options?.autoStartWeb) {
    await startWeb();
  }

  return {
    agent,
    memory,
    knowledge,
    planner,
    conversations,
    notifications,
    events,
    safety,
    analytics,
    quality,
    scheduler,
    web,
    llm,
    startWeb,
    shutdown,
    chat,
    getFullStatus,
  };
}
