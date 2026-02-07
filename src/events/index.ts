/**
 * Events 模块 — 统一事件系统
 *
 * - EventBus: 类型安全的事件发布/订阅 + 中间件 + 历史回放
 */

export { EventBus, getEventBus, resetEventBus } from "./bus.js";
export type {
  AgentEvents,
  AgentEventName,
  AgentEventData,
  EventListener,
  EventMeta,
  EventMiddleware,
  EventRecord,
} from "./bus.js";
