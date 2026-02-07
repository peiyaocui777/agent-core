/**
 * Skills 系统 — 类型定义
 *
 * 参考 OpenClaw Skills 架构设计：
 * - 每个 Skill 是一个独立可加载的能力包
 * - 包含元数据（skill.json）+ 工具实现（index.ts）
 * - 支持热加载、动态创建、优先级覆盖
 */

import type { Tool, ToolResult, AgentConfig } from "../types.js";

// ==================== Skill 元数据 ====================

/** Skill 分类 */
export type SkillCategory =
  | "content"       // 内容相关（采集/生成/摘要）
  | "publish"       // 平台发布
  | "infrastructure" // 基础设施（图床/CDN/邮箱）
  | "communication" // 通讯（Telegram/WeChat Bot）
  | "memory"        // 记忆系统
  | "workflow"      // 工作流编排
  | "system";       // 系统级（文件操作/浏览器控制）

/** Skill 权限 */
export type SkillPermission =
  | "network"       // 网络请求
  | "filesystem"    // 文件读写
  | "browser"       // 浏览器控制
  | "shell"         // Shell 命令执行
  | "llm";          // LLM API 调用

/** Skill 依赖要求 */
export interface SkillRequirements {
  /** 需要的二进制工具 (e.g. ["playwright", "python3"]) */
  bins?: string[];
  /** 需要的环境变量 (e.g. ["DEEPSEEK_API_KEY"]) */
  env?: string[];
  /** 需要的配置项 (e.g. ["llm.apiKey"]) */
  config?: string[];
  /** 操作系统限制 */
  os?: ("darwin" | "linux" | "win32")[];
}

/** skill.json 完整 Schema */
export interface SkillMeta {
  /** 唯一标识（目录名） */
  name: string;
  /** 版本号 */
  version: string;
  /** 一句话描述 */
  description: string;
  /** 作者 */
  author?: string;
  /** Skill 分类 */
  category: SkillCategory;
  /** 搜索标签 */
  tags?: string[];
  /** 触发词（自然语言中出现这些词会优先匹配此 Skill） */
  triggers?: string[];
  /** 暴露的工具列表描述（实际实现在 index.ts） */
  tools?: string[];
  /** 依赖的其他 Skill */
  dependencies?: string[];
  /** 运行时需求 */
  requires?: SkillRequirements;
  /** 所需权限 */
  permissions?: SkillPermission[];
  /** 是否启用 */
  enabled?: boolean;
  /** Skill 配置 Schema（用户可配置的参数） */
  configSchema?: Record<string, {
    type: "string" | "number" | "boolean";
    description: string;
    required?: boolean;
    default?: unknown;
  }>;
  /** 优先级（workspace > managed > bundled） */
  priority?: number;
}

// ==================== Skill 实例 ====================

/** Skill 生命周期接口 */
export interface Skill {
  /** 元数据 */
  readonly meta: SkillMeta;

  /** 此 Skill 提供的 Tools */
  readonly tools: Tool[];

  /**
   * 激活 Skill
   * 在此处初始化资源、建立连接等
   */
  activate(config: AgentConfig): Promise<void>;

  /**
   * 停用 Skill
   * 清理资源、关闭连接
   */
  deactivate(): Promise<void>;

  /**
   * 健康检查（可选）
   * 返回 Skill 当前是否可用
   */
  healthCheck?(): Promise<{ healthy: boolean; message?: string }>;
}

/** Skill 工厂函数签名 */
export type SkillFactory = (config: AgentConfig) => Skill;

// ==================== Skill Runtime ====================

/** Skill 加载来源 */
export type SkillSource = "bundled" | "managed" | "workspace" | "runtime";

/** 已加载的 Skill 条目 */
export interface LoadedSkill {
  skill: Skill;
  source: SkillSource;
  path?: string;           // 文件系统路径（runtime 创建的可能没有）
  loadedAt: Date;
  active: boolean;
  error?: string;          // 加载/激活时的错误
}

/** Skill 安装请求 */
export interface SkillInstallRequest {
  /** 来源 URL（GitHub / npm / 本地路径） */
  source: string;
  /** 安装到哪个目录 */
  target?: "managed" | "workspace";
}

/** Skill 搜索结果 */
export interface SkillSearchResult {
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  source: SkillSource;
  active: boolean;
  toolCount: number;
  tools: string[];
}

// ==================== Skill 创建（自扩展） ====================

/** AI 自创建 Skill 的规格 */
export interface SkillSpec {
  /** Skill 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 需要实现的工具 */
  tools: {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required: boolean }>;
  }[];
  /** 额外说明（给 AI 的提示） */
  instructions?: string;
}

// ==================== Memory 类型 ====================

/** 聊天消息 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/** 记忆条目 */
export interface MemoryItem {
  id: string;
  key: string;
  value: unknown;
  tags: string[];
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
}

/** 用户画像 */
export interface UserProfile {
  /** 昵称 */
  nickname?: string;
  /** 偏好的内容领域 */
  preferredTopics?: string[];
  /** 偏好的写作风格 */
  preferredStyle?: string;
  /** 常用平台 */
  platforms?: string[];
  /** 发布频率偏好 */
  publishFrequency?: string;
  /** 自定义字段 */
  custom?: Record<string, unknown>;
}

/** 发布记录 */
export interface PublishRecord {
  id: string;
  platform: string;
  title: string;
  status: "success" | "failed";
  url?: string;
  publishedAt: Date;
  metadata?: Record<string, unknown>;
}

/** Memory 搜索过滤器 */
export interface MemoryFilter {
  tags?: string[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

/** 发布历史过滤器 */
export interface PublishFilter {
  platform?: string;
  status?: "success" | "failed";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}
