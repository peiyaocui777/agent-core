/**
 * @jarvis/agent-core v7
 *
 * AI 分身 (Jarvis) — 你的个人 AI 助手核心引擎
 *
 * 开源 · 自用 · 桌面/网页端
 * 参考 OpenClaw (147k stars) 架构设计
 *
 * v7 新增：
 * - LLM Streaming — 真实 SSE 流式输出
 * - KnowledgeBase — 本地知识库（文档导入/分块/向量化/RAG）
 * - NotificationCenter — 通知中心（多渠道/事件规则/推送）
 * - ConversationManager — 对话管理（持久化/搜索/导出/编辑）
 * - DesktopBuilder — Tauri 桌面端配置生成
 *
 * 快速开始：
 * ```ts
 * import { createAgent, VectorMemory, AutonomousPlanner, WebChatServer, ConfigLoader } from "@jarvis/agent-core";
 *
 * // 1. 加载配置
 * const configLoader = new ConfigLoader();
 * const config = configLoader.load();
 *
 * // 2. 创建 Agent
 * const agent = createAgent({ name: config.agent.name });
 *
 * // 3. 向量记忆
 * const memory = new VectorMemory({ dataPath: "./data/memory.json" });
 * memory.remember("用户喜欢简洁风格的小红书笔记", "preference");
 *
 * // 4. 自主任务
 * const planner = new AutonomousPlanner();
 * await planner.execute({ id: "1", goal: "采集热点并生成小红书笔记", priority: "high" });
 *
 * // 5. Web 界面
 * const web = new WebChatServer(agent, { port: 3900 }, { vectorMemory: memory, planner });
 * await web.start();
 * ```
 */

// ==================== 核心类 ====================

export { AgentCore } from "./agent.js";
export { Scheduler } from "./scheduler.js";
export type { ScheduledJob, JobExecution, SchedulerConfig } from "./scheduler.js";

// ==================== Skills 系统 ====================

export { SkillRuntime } from "./skills/runtime.js";
export { defineSkill, wrapToolsAsSkill } from "./skills/define.js";
export { getAllBundledSkills } from "./skills/bundled/index.js";
export {
  contentScraperSkill,
  contentWriterSkill,
  xhsPublisherSkill,
  wechatPublisherSkill,
  multiDistributorSkill,
  douyinPublisherSkill,
  bilibiliPublisherSkill,
  weiboPublisherSkill,
  zhihuPublisherSkill,
  browserPilotSkill,
} from "./skills/bundled/index.js";

export type {
  Skill,
  SkillMeta,
  SkillFactory,
  SkillCategory,
  SkillPermission,
  SkillRequirements,
  SkillSource,
  LoadedSkill,
  SkillSearchResult,
  SkillInstallRequest,
  SkillSpec,
  ChatMessage,
  MemoryItem,
  UserProfile,
  PublishRecord,
  MemoryFilter,
  PublishFilter,
} from "./skills/types.js";

// ==================== Memory 系统 ====================

export { MemoryStore } from "./memory/store.js";
export { VectorMemory } from "./memory/vector-store.js";
export type {
  VectorEntry,
  SearchResult,
  VectorMemoryConfig,
  RAGContext,
} from "./memory/vector-store.js";

// ==================== Intent 引擎 ====================

export { IntentEngine } from "./intent/engine.js";
export type { IntentEngineConfig, ExecutionPlan } from "./intent/engine.js";

// ==================== Persona 人格系统 ====================

export { PersonaManager, PERSONA_PRESETS } from "./persona/persona.js";
export type { PersonaConfig } from "./persona/persona.js";

// ==================== Skill 自创建 ====================

export { SkillCreator } from "./skills/creator.js";
export type { CreatedSkill } from "./skills/creator.js";

// ==================== 通讯桥接 ====================

export { TelegramBridge } from "./bridges/telegram.js";
export type { TelegramBridgeConfig } from "./bridges/telegram.js";
export { CLIBridge } from "./bridges/cli.js";

// ==================== MCP 协议 ====================

export { McpServer } from "./mcp/server.js";
export { McpClient } from "./mcp/client.js";
export type { McpClientConfig } from "./mcp/client.js";
export { McpManager, DEFAULT_MCP_SERVERS } from "./mcp/manager.js";
export type { McpManagerConfig, McpServerEntry } from "./mcp/manager.js";

// ==================== Multi-Agent 协作 ====================

export { Orchestrator } from "./multi-agent/orchestrator.js";
export {
  ALL_ROLES,
  ROLE_WRITER,
  ROLE_EDITOR,
  ROLE_PUBLISHER,
  ROLE_ANALYST,
  ROLE_COORDINATOR,
  getRole,
  getAllRoles,
} from "./multi-agent/roles.js";
export type {
  AgentRole,
  AgentRoleId,
  AgentMessage,
  CollaborationTask,
  CollaborationPhase,
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestrationStrategy,
  MessageType,
} from "./multi-agent/types.js";

// ==================== Workflow 管道引擎 ====================

export { WorkflowEngine } from "./workflow/engine.js";
export {
  CONTENT_CREATION_PIPELINE,
  MULTI_PUBLISH_PIPELINE,
  DAILY_REPORT_PIPELINE,
  getAllPresetPipelines,
} from "./workflow/presets.js";
export type {
  PipelineDefinition,
  PipelineNode,
  PipelineEdge,
  PipelineContext,
  PipelineLog,
  PipelineEvent,
  NodeType,
  NodeStatus,
  NodeConfig,
  ToolNodeConfig,
  ConditionNodeConfig,
  ParallelNodeConfig,
  ApprovalNodeConfig,
  TransformNodeConfig,
  DelayNodeConfig,
  SubflowNodeConfig,
} from "./workflow/types.js";

// ==================== Marketplace ====================

export { SkillRegistry } from "./marketplace/registry.js";
export { BUILTIN_PACKAGES, getBuiltinPackages } from "./marketplace/builtin-packages.js";
export type {
  MarketplacePackage,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstallResult,
  RegistryConfig,
  PackageAuthor,
  PackageSource,
  PackageRating,
  PackageReview,
} from "./marketplace/types.js";

// ==================== Dashboard ====================

export { DashboardServer } from "./dashboard/server.js";
export type { DashboardConfig } from "./dashboard/server.js";

// ==================== Web Chat UI ====================

export { WebChatServer } from "./web/chat-server.js";
export type { WebChatConfig } from "./web/chat-server.js";

// ==================== Autonomous Planner ====================

export { AutonomousPlanner } from "./autonomous/planner.js";
export type {
  TaskGoal,
  PlanStep,
  ExecutionTrace,
  Reflection,
  PlannerConfig,
} from "./autonomous/planner.js";

// ==================== 配置中心 ====================

export { ConfigLoader } from "./config/loader.js";
export type { JarvisConfig } from "./config/loader.js";

// ==================== Knowledge Base ====================

export { KnowledgeBase } from "./knowledge/base.js";
export type {
  KnowledgeDocument,
  KnowledgeChunk,
  QueryResult,
  KnowledgeBaseConfig,
} from "./knowledge/base.js";

// ==================== Notification Center ====================

export { NotificationCenter } from "./notification/center.js";
export type {
  Notification,
  NotificationType,
  NotificationChannel,
  NotificationAction,
  NotificationRule,
  NotificationCenterConfig,
} from "./notification/center.js";

// ==================== Conversation Manager ====================

export { ConversationManager } from "./conversation/manager.js";
export type {
  Conversation,
  ConversationMessage,
  ConversationManagerConfig,
  ConversationSearchOptions,
} from "./conversation/manager.js";

// ==================== Desktop (Tauri) ====================

export { DesktopBuilder } from "./desktop/tauri-config.js";
export type { TauriProjectConfig } from "./desktop/tauri-config.js";

// ==================== Safety 风控系统 ====================

export { SafetyEngine } from "./safety/engine.js";
export type {
  SafetyEngineConfig,
  SafetyCheckResult,
  Violation,
  ViolationType,
  SafetyLevel,
  RateLimit,
  RateLimitResult,
  PlatformRule,
  PlatformCheckResult,
  AntiBlockConfig,
} from "./safety/types.js";

// ==================== Analytics 数据分析 ====================

export { AnalyticsEngine } from "./analytics/engine.js";
export type {
  AnalyticsConfig,
  AnalyticsPlatform,
  ContentMetrics,
  CrossPlatformReport,
  PlatformOverview,
  DailyAggregate,
  TagPerformance,
  TimeRange,
  SEOScoreResult,
  SEOCheckItem,
} from "./analytics/types.js";

// ==================== Quality 质量引擎 ====================

export { QualityEngine } from "./quality/engine.js";
export type {
  QualityEngineConfig,
  QualityScoreResult,
  DimensionScore,
  QualityDimension,
  Recommendation,
  OriginalityResult,
  SuspiciousFragment,
  OptimizeOptions,
  OptimizeResult,
} from "./quality/types.js";

// ==================== 新平台工具集 ====================

export { createDouyinTools } from "./tools/douyin.js";
export { createBilibiliTools } from "./tools/bilibili.js";
export { createWeiboTools } from "./tools/weibo.js";
export { createZhihuTools } from "./tools/zhihu.js";
export { createBrowserTools } from "./tools/browser.js";

// ==================== CronMaestro 调度引擎 ====================

export { CronMaestro } from "./scheduler/cron-maestro.js";
export type { ScheduledTask, CronMaestroConfig } from "./scheduler/cron-maestro.js";

// ==================== EventBus 事件系统 ====================

export { EventBus, getEventBus, resetEventBus } from "./events/bus.js";
export type {
  AgentEvents,
  AgentEventName,
  AgentEventData,
  EventListener,
  EventMeta,
  EventMiddleware,
  EventRecord,
} from "./events/bus.js";

// ==================== Plugin SDK ====================

export { PluginSDK } from "./sdk/plugin-sdk.js";
export type {
  PluginDefinition,
  ToolDefinition,
  ToolContext,
  ToolTestCase,
  TestReport,
} from "./sdk/plugin-sdk.js";

// ==================== SaaS 多租户 ====================

export { TenantManager } from "./saas/tenant-manager.js";
export type {
  SaasConfig,
  TenantAccount,
  ApiKeyInfo,
  ApiPermission,
  PlanTier,
  QuotaType,
  QuotaLimit,
  PlanQuotas,
  UsageRecord,
  MonthlyBill,
  OverageCharge,
  TenantSettings,
} from "./saas/types.js";

// ==================== 类型导出 ====================

export type {
  Tool,
  ToolParameter,
  ToolResult,
  ToolCategory,
  TaskStep,
  AgentTask,
  AgentConfig,
  ParsedIntent,
} from "./types.js";

// ==================== 旧版工具集（向后兼容） ====================

export { createAllDefaultTools } from "./tools/defaults.js";
export { createXhsTools } from "./tools/xhs.js";
export { createWechatTools } from "./tools/wechat.js";
export { createAiTools } from "./tools/ai.js";
export { createWorkflowTools } from "./tools/workflow.js";
export { createScraperTools } from "./tools/scraper.js";
export { createMultiPublishTools } from "./tools/multi-publish.js";

// ==================== LLM Provider ====================

export { LLMClient, createLLMClient, getAvailableProviders } from "./providers/llm.js";
export type { LLMMessage, LLMResponse, LLMOptions } from "./providers/llm.js";

// ==================== 便捷工厂函数 ====================

import { AgentCore } from "./agent.js";
import { getAllBundledSkills } from "./skills/bundled/index.js";
import type { AgentConfig } from "./types.js";
import type { IntentEngineConfig } from "./intent/engine.js";

/**
 * 一键创建预配置的 Agent 实例（v2）
 *
 * 自动注册所有内置 Skill + 初始化 Memory + IntentEngine
 */
export function createAgent(
  config: AgentConfig = {},
  intentConfig?: IntentEngineConfig
): AgentCore {
  const agent = new AgentCore(config, intentConfig);

  // 注册所有内置 Skill
  agent.registerSkills(getAllBundledSkills());

  return agent;
}

/**
 * 一键创建并初始化 Agent（异步）
 *
 * 创建 + 加载记忆 + 激活 Skill
 */
export async function createAndInitAgent(
  config: AgentConfig = {},
  intentConfig?: IntentEngineConfig
): Promise<AgentCore> {
  const agent = createAgent(config, intentConfig);
  await agent.initialize();
  return agent;
}

// ==================== 一键启动（推荐） ====================

export { createJarvis } from "./bootstrap.js";
export type {
  JarvisInstance,
  JarvisStatus,
  JarvisOptions,
} from "./bootstrap.js";
