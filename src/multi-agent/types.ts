/**
 * Multi-Agent 类型定义
 *
 * 定义多角色协作所需的核心类型：
 * - AgentRole: 角色定义（写手/编辑/发布员/自定义）
 * - AgentMessage: Agent 间通信消息
 * - CollaborationTask: 协作任务
 * - OrchestratorConfig: 编排器配置
 */

import type { ToolResult, TaskStep, AgentConfig, ToolCategory } from "../types.js";

// ==================== 角色定义 ====================

/** Agent 角色 ID */
export type AgentRoleId = "writer" | "editor" | "publisher" | "analyst" | "coordinator" | string;

/** 角色定义 */
export interface AgentRole {
  /** 唯一标识 */
  id: AgentRoleId;
  /** 角色名称 */
  name: string;
  /** 角色描述 */
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 可使用的工具分类 */
  allowedCategories: ToolCategory[];
  /** 可使用的工具名称（更细粒度控制） */
  allowedTools?: string[];
  /** 最大并行任务数 */
  maxConcurrency?: number;
  /** 是否需要人工审批 */
  requiresApproval?: boolean;
}

// ==================== Agent 间通信 ====================

/** 消息类型 */
export type MessageType =
  | "task_assign"      // 分配任务
  | "task_result"      // 任务结果
  | "review_request"   // 请求审阅
  | "review_feedback"  // 审阅反馈
  | "approval_request" // 请求审批
  | "approval_result"  // 审批结果
  | "status_update"    // 状态更新
  | "handoff"          // 交接
  | "chat";            // 自由沟通

/** Agent 间消息 */
export interface AgentMessage {
  /** 消息 ID */
  id: string;
  /** 发送者角色 */
  from: AgentRoleId;
  /** 接收者角色 */
  to: AgentRoleId;
  /** 消息类型 */
  type: MessageType;
  /** 消息内容 */
  content: string;
  /** 附加数据（如生成的文章、审阅建议等） */
  payload?: Record<string, unknown>;
  /** 关联的协作任务 ID */
  taskId?: string;
  /** 时间戳 */
  timestamp: Date;
}

// ==================== 协作任务 ====================

/** 协作任务阶段 */
export interface CollaborationPhase {
  /** 阶段 ID */
  id: string;
  /** 阶段名称 */
  name: string;
  /** 负责的角色 */
  assignedTo: AgentRoleId;
  /** 阶段状态 */
  status: "pending" | "in_progress" | "reviewing" | "approved" | "completed" | "failed";
  /** 输入数据（来自上一阶段） */
  input?: Record<string, unknown>;
  /** 输出数据 */
  output?: Record<string, unknown>;
  /** 工具步骤 */
  steps: TaskStep[];
  /** 审阅反馈 */
  feedback?: string;
  /** 重试次数 */
  retryCount?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 依赖的阶段 ID */
  dependsOn?: string[];
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
}

/** 协作任务 */
export interface CollaborationTask {
  /** 任务 ID */
  id: string;
  /** 用户原始指令 */
  instruction: string;
  /** 任务类型 */
  type: "content_pipeline" | "review_pipeline" | "publish_pipeline" | "custom";
  /** 各阶段 */
  phases: CollaborationPhase[];
  /** 任务状态 */
  status: "planning" | "executing" | "paused" | "completed" | "failed";
  /** 创建时间 */
  createdAt: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 全局上下文（跨阶段共享） */
  context: Record<string, unknown>;
}

// ==================== 编排器 ====================

/** 编排策略 */
export type OrchestrationStrategy =
  | "sequential"  // 顺序执行（写手 → 编辑 → 发布员）
  | "parallel"    // 并行执行（适合独立任务）
  | "review_loop" // 审阅循环（编辑可以打回给写手）
  | "adaptive";   // 自适应（LLM 决定流程）

/** 编排器配置 */
export interface OrchestratorConfig {
  /** 编排策略 */
  strategy: OrchestrationStrategy;
  /** 最大审阅轮次 */
  maxReviewRounds?: number;
  /** Agent 配置 */
  agentConfig?: AgentConfig;
  /** 是否启用人工审批 */
  humanApproval?: boolean;
  /** 审批超时（毫秒） */
  approvalTimeout?: number;
}

// ==================== 事件 ====================

export type OrchestratorEvent =
  | { type: "phase_started"; taskId: string; phaseId: string; role: AgentRoleId }
  | { type: "phase_completed"; taskId: string; phaseId: string; role: AgentRoleId; output: unknown }
  | { type: "phase_failed"; taskId: string; phaseId: string; role: AgentRoleId; error: string }
  | { type: "review_requested"; taskId: string; phaseId: string; from: AgentRoleId; to: AgentRoleId }
  | { type: "review_feedback"; taskId: string; phaseId: string; approved: boolean; feedback: string }
  | { type: "task_completed"; taskId: string; result: CollaborationTask }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "message"; message: AgentMessage };
