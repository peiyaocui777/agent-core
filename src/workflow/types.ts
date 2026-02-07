/**
 * Workflow Engine 类型定义
 *
 * 参考 Lobster 的 typed workflow engine：
 * - Pipeline: 有向无环图形式的管道
 * - Node: 管道中的节点（工具调用/条件/并行/审批）
 * - Edge: 连接节点的边（数据流向）
 * - Context: 管道执行上下文（状态持久化）
 */

import type { ToolResult } from "../types.js";

// ==================== 节点类型 ====================

/** 节点类型 */
export type NodeType =
  | "tool"       // 工具调用
  | "condition"  // 条件分支
  | "parallel"   // 并行执行
  | "approval"   // 人工审批
  | "transform"  // 数据转换
  | "delay"      // 延时
  | "subflow";   // 子管道

/** 节点状态 */
export type NodeStatus = "idle" | "running" | "completed" | "failed" | "skipped" | "waiting";

/** 管道节点 */
export interface PipelineNode {
  /** 节点 ID */
  id: string;
  /** 节点类型 */
  type: NodeType;
  /** 节点名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 节点配置 */
  config: NodeConfig;
  /** 当前状态 */
  status: NodeStatus;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 重试配置 */
  retry?: { maxAttempts: number; delayMs: number; currentAttempt?: number };
  /** 超时（毫秒） */
  timeoutMs?: number;
}

/** 节点配置（union） */
export type NodeConfig =
  | ToolNodeConfig
  | ConditionNodeConfig
  | ParallelNodeConfig
  | ApprovalNodeConfig
  | TransformNodeConfig
  | DelayNodeConfig
  | SubflowNodeConfig;

/** 工具节点配置 */
export interface ToolNodeConfig {
  type: "tool";
  /** 工具名称 */
  toolName: string;
  /** 静态参数 */
  params?: Record<string, unknown>;
  /** 参数映射（从上下文取值，格式: { paramKey: "context.path" }） */
  paramMapping?: Record<string, string>;
  /** 输出映射到上下文的 key */
  outputKey?: string;
}

/** 条件节点配置 */
export interface ConditionNodeConfig {
  type: "condition";
  /** 条件表达式（JavaScript 表达式，访问 ctx） */
  expression: string;
  /** 条件为 true 走的分支 */
  trueBranch: string;   // 目标 nodeId
  /** 条件为 false 走的分支 */
  falseBranch: string;  // 目标 nodeId
}

/** 并行节点配置 */
export interface ParallelNodeConfig {
  type: "parallel";
  /** 并行执行的节点 ID 列表 */
  nodeIds: string[];
  /** 等待策略 */
  waitFor: "all" | "any";
}

/** 审批节点配置 */
export interface ApprovalNodeConfig {
  type: "approval";
  /** 审批提示 */
  prompt: string;
  /** 超时后的默认动作 */
  defaultAction: "approve" | "reject";
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/** 数据转换节点配置 */
export interface TransformNodeConfig {
  type: "transform";
  /** 转换函数体（输入 ctx，返回转换后的值） */
  transformFn: string;
  /** 输出到上下文的 key */
  outputKey: string;
}

/** 延时节点配置 */
export interface DelayNodeConfig {
  type: "delay";
  /** 延时毫秒 */
  delayMs: number;
}

/** 子管道节点配置 */
export interface SubflowNodeConfig {
  type: "subflow";
  /** 子管道 ID */
  pipelineId: string;
  /** 输入映射 */
  inputMapping?: Record<string, string>;
  /** 输出映射 */
  outputMapping?: Record<string, string>;
}

// ==================== 边（数据流） ====================

/** 管道边 */
export interface PipelineEdge {
  /** 源节点 */
  from: string;
  /** 目标节点 */
  to: string;
  /** 条件标签（可选，用于条件分支标注） */
  label?: string;
}

// ==================== Pipeline 定义 ====================

/** 管道定义 */
export interface PipelineDefinition {
  /** 管道 ID */
  id: string;
  /** 管道名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 版本号 */
  version: string;
  /** 节点列表 */
  nodes: PipelineNode[];
  /** 边（数据流） */
  edges: PipelineEdge[];
  /** 入口节点 ID */
  entryNodeId: string;
  /** 全局默认参数 */
  defaults?: Record<string, unknown>;
  /** 创建时间 */
  createdAt?: Date;
  /** 更新时间 */
  updatedAt?: Date;
}

// ==================== Pipeline 执行上下文 ====================

/** 管道执行上下文 */
export interface PipelineContext {
  /** 管道 ID */
  pipelineId: string;
  /** 执行 ID */
  runId: string;
  /** 上下文数据 */
  data: Record<string, unknown>;
  /** 节点状态快照 */
  nodeStates: Record<string, NodeStatus>;
  /** 执行日志 */
  logs: PipelineLog[];
  /** 开始时间 */
  startedAt: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 总体状态 */
  status: "running" | "completed" | "failed" | "paused";
}

/** 管道执行日志 */
export interface PipelineLog {
  timestamp: Date;
  nodeId: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

// ==================== 事件 ====================

export type PipelineEvent =
  | { type: "node_started"; runId: string; nodeId: string }
  | { type: "node_completed"; runId: string; nodeId: string; result: unknown }
  | { type: "node_failed"; runId: string; nodeId: string; error: string }
  | { type: "node_skipped"; runId: string; nodeId: string; reason: string }
  | { type: "pipeline_completed"; runId: string; context: PipelineContext }
  | { type: "pipeline_failed"; runId: string; error: string }
  | { type: "approval_required"; runId: string; nodeId: string; prompt: string };
