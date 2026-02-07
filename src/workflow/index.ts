/**
 * Workflow 模块 — 管道编排引擎
 *
 * - WorkflowEngine: DAG 管道执行引擎
 * - Presets: 预设管道模板
 * - Types: 管道、节点、边、上下文等类型
 */

export { WorkflowEngine } from "./engine.js";
export {
  CONTENT_CREATION_PIPELINE,
  MULTI_PUBLISH_PIPELINE,
  DAILY_REPORT_PIPELINE,
  getAllPresetPipelines,
} from "./presets.js";
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
} from "./types.js";
