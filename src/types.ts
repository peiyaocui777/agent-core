/**
 * Agent Core 类型定义
 */

/** 工具参数定义 */
export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  default?: unknown;
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** 工具接口 —— 所有 Agent 工具必须实现 */
export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: Record<string, ToolParameter>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/** 工具分类 */
export type ToolCategory =
  | "auth"        // 登录认证
  | "generate"    // 内容生成
  | "format"      // 格式化适配
  | "publish"     // 平台发布
  | "infra"       // 基础设施
  | "workflow";   // 工作流

/** 任务步骤 */
export interface TaskStep {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: ToolResult;
  dependsOn?: string[];
}

/** Agent 任务 */
export interface AgentTask {
  id: string;
  userInstruction: string;
  steps: TaskStep[];
  status: "planning" | "executing" | "completed" | "failed";
  createdAt: Date;
  completedAt?: Date;
}

/** Agent 配置 */
export interface AgentConfig {
  /** Agent 名称 */
  name?: string;
  /** 小红书 MCP 服务地址 */
  xhsApiUrl?: string;
  /** 微信公众号 wenyan-mcp 地址 */
  wechatApiUrl?: string;
  /** AI Trend Publish 地址 */
  trendApiUrl?: string;
  /** 图床地址 */
  imgBedUrl?: string;
  /** 浏览器是否无头模式 */
  browserHeadless?: boolean;
  /** LLM Provider 配置 */
  llm?: {
    provider: "openai" | "deepseek" | "gemini" | "claude" | "siliconflow" | "zhipu" | "moonshot" | "qwen" | "doubao" | "groq" | "ollama" | "lmstudio" | "custom";
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
}

/** 意图识别结果 */
export interface ParsedIntent {
  intent: "publish_xhs" | "publish_wechat" | "publish_all" | "search" | "generate" | "workflow" | "unknown";
  platform?: string;
  topic?: string;
  rawInstruction: string;
}
