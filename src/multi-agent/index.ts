/**
 * Multi-Agent 模块 — 多角色协作系统
 *
 * - Orchestrator: 编排引擎（顺序/并行/审阅循环/自适应）
 * - Roles: 预设角色（写手/编辑/发布员/分析师/协调员）
 * - Types: 协作任务、消息、阶段等类型
 */

export { Orchestrator } from "./orchestrator.js";
export {
  ALL_ROLES,
  ROLE_WRITER,
  ROLE_EDITOR,
  ROLE_PUBLISHER,
  ROLE_ANALYST,
  ROLE_COORDINATOR,
  getRole,
  getAllRoles,
} from "./roles.js";
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
} from "./types.js";
