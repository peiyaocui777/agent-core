/**
 * EventBus — 统一事件系统
 *
 * 功能：
 * 1. 类型安全的事件发布/订阅
 * 2. 通配符监听（*）
 * 3. 一次性监听（once）
 * 4. 事件历史回放
 * 5. 中间件/拦截器
 * 6. WebSocket 广播适配（给 Dashboard 推送实时状态）
 *
 * 所有模块（Safety/Quality/Analytics/Scheduler/Orchestrator/Workflow）
 * 通过 EventBus 通信，实现松耦合。
 */

// ==================== 事件类型定义 ====================

/** 所有系统事件 */
export interface AgentEvents {
  // 生命周期
  "agent:ready": { timestamp: string };
  "agent:shutdown": { reason?: string };

  // Skill
  "skill:loaded": { name: string; version: string };
  "skill:unloaded": { name: string };
  "skill:error": { name: string; error: string };

  // 工具执行
  "tool:start": { tool: string; params: Record<string, unknown> };
  "tool:success": { tool: string; result: unknown; durationMs: number };
  "tool:error": { tool: string; error: string; durationMs: number };

  // 内容发布
  "publish:start": { platform: string; title: string };
  "publish:success": { platform: string; title: string; url?: string };
  "publish:failed": { platform: string; title: string; error: string };
  "publish:error": { platform: string; title: string; error: string };

  // 任务
  "task:completed": { taskId: string; result?: string };
  "task:failed": { taskId: string; error: string };

  // 风控
  "safety:blocked": { platform: string; reason: string; riskScore: number };
  "safety:warning": { type: string; description: string };

  // 质量
  "quality:scored": { title: string; score: number; grade: string };
  "quality:optimized": { title: string; before: number; after: number };

  // 分析
  "analytics:tracked": { platform: string; contentId: string };
  "analytics:report": { timeRange: string; totalViews: number };

  // 调度
  "cron:created": { taskId: string; description: string; cron: string };
  "cron:executed": { taskId: string; result: string };
  "cron:failed": { taskId: string; error: string };

  // 多 Agent
  "orchestrator:start": { taskId: string; strategy: string };
  "orchestrator:phase": { taskId: string; phase: string; status: string };
  "orchestrator:complete": { taskId: string; result: string };

  // Workflow
  "workflow:start": { pipelineId: string; runId: string };
  "workflow:node": { pipelineId: string; nodeId: string; status: string };
  "workflow:complete": { pipelineId: string; runId: string; status: string };

  // MCP
  "mcp:connected": { server: string };
  "mcp:disconnected": { server: string; reason?: string };
  "mcp:tool_called": { server: string; tool: string };

  // 通用
  "log:info": { message: string; source?: string };
  "log:warn": { message: string; source?: string };
  "log:error": { message: string; source?: string; stack?: string };
}

/** 事件名称 */
export type AgentEventName = keyof AgentEvents;

/** 事件数据 */
export type AgentEventData<K extends AgentEventName> = AgentEvents[K];

/** 监听器 */
export type EventListener<K extends AgentEventName> = (
  data: AgentEventData<K>,
  meta: EventMeta
) => void | Promise<void>;

/** 事件元数据 */
export interface EventMeta {
  eventName: string;
  timestamp: string;
  source?: string;
}

/** 中间件 */
export type EventMiddleware = (
  eventName: string,
  data: unknown,
  meta: EventMeta,
  next: () => void
) => void | Promise<void>;

/** 事件历史记录 */
export interface EventRecord {
  eventName: string;
  data: unknown;
  meta: EventMeta;
}

// ==================== EventBus ====================

export class EventBus {
  private listeners = new Map<string, Set<{ fn: Function; once: boolean }>>();
  private middlewares: EventMiddleware[] = [];
  private history: EventRecord[] = [];
  private maxHistory: number;

  /** WebSocket 广播回调（由 Dashboard 设置） */
  private broadcastFn?: (event: EventRecord) => void;

  constructor(options?: { maxHistory?: number }) {
    this.maxHistory = options?.maxHistory || 1000;
  }

  // ==================== 订阅 ====================

  /**
   * 订阅事件
   */
  on<K extends AgentEventName>(
    event: K,
    listener: EventListener<K>
  ): () => void {
    return this.addListener(event, listener, false);
  }

  /**
   * 一次性订阅
   */
  once<K extends AgentEventName>(
    event: K,
    listener: EventListener<K>
  ): () => void {
    return this.addListener(event, listener, true);
  }

  /**
   * 订阅所有事件（通配符）
   */
  onAny(listener: (eventName: string, data: unknown, meta: EventMeta) => void): () => void {
    return this.addListener("*", listener as Function, false);
  }

  /**
   * 取消订阅
   */
  off<K extends AgentEventName>(event: K, listener: EventListener<K>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const item of set) {
      if (item.fn === listener) {
        set.delete(item);
        break;
      }
    }
  }

  // ==================== 发布 ====================

  /**
   * 发布事件
   */
  async emit<K extends AgentEventName>(
    event: K,
    data: AgentEventData<K>,
    source?: string
  ): Promise<void> {
    const meta: EventMeta = {
      eventName: event,
      timestamp: new Date().toISOString(),
      source,
    };

    // 记录历史
    const record: EventRecord = { eventName: event, data, meta };
    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // 执行中间件链
    let blocked = false;
    for (const mw of this.middlewares) {
      let continued = false;
      await mw(event, data, meta, () => { continued = true; });
      if (!continued) {
        blocked = true;
        break;
      }
    }
    if (blocked) return;

    // 触发特定事件监听器
    const set = this.listeners.get(event);
    if (set) {
      const toRemove: Array<{ fn: Function; once: boolean }> = [];
      for (const item of set) {
        try {
          await item.fn(data, meta);
        } catch {
          // 监听器错误不影响其他监听器
        }
        if (item.once) toRemove.push(item);
      }
      for (const item of toRemove) set.delete(item);
    }

    // 触发通配符监听器
    const wildcardSet = this.listeners.get("*");
    if (wildcardSet) {
      for (const item of wildcardSet) {
        try {
          await (item.fn as Function)(event, data, meta);
        } catch {
          // ignore
        }
      }
    }

    // WebSocket 广播
    if (this.broadcastFn) {
      try { this.broadcastFn(record); } catch {}
    }
  }

  // ==================== 中间件 ====================

  /**
   * 添加中间件（拦截器）
   * 调用 next() 继续传播，不调用则拦截
   */
  use(middleware: EventMiddleware): void {
    this.middlewares.push(middleware);
  }

  // ==================== 历史 ====================

  /**
   * 获取事件历史
   */
  getHistory(filter?: {
    eventName?: string;
    limit?: number;
    since?: string;
  }): EventRecord[] {
    let records = this.history;

    if (filter?.eventName) {
      records = records.filter((r) => r.eventName === filter.eventName);
    }

    if (filter?.since) {
      const since = new Date(filter.since);
      records = records.filter((r) => new Date(r.meta.timestamp) >= since);
    }

    if (filter?.limit) {
      records = records.slice(-filter.limit);
    }

    return records;
  }

  /** 清空历史 */
  clearHistory(): void {
    this.history = [];
  }

  // ==================== WebSocket 适配 ====================

  /**
   * 设置 WebSocket 广播函数
   * Dashboard 启动时调用此方法，将事件推送给所有连接的客户端
   */
  setBroadcast(fn: (event: EventRecord) => void): void {
    this.broadcastFn = fn;
  }

  // ==================== 统计 ====================

  getStatus(): {
    listenerCount: number;
    eventTypes: number;
    middlewareCount: number;
    historySize: number;
  } {
    let listenerCount = 0;
    for (const set of this.listeners.values()) {
      listenerCount += set.size;
    }

    return {
      listenerCount,
      eventTypes: this.listeners.size,
      middlewareCount: this.middlewares.length,
      historySize: this.history.length,
    };
  }

  /** 移除所有监听器 */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  // ==================== 内部 ====================

  private addListener(event: string, fn: Function, once: boolean): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const item = { fn, once };
    this.listeners.get(event)!.add(item);

    // 返回取消函数
    return () => {
      this.listeners.get(event)?.delete(item);
    };
  }
}

// ==================== 全局单例 ====================

let _globalBus: EventBus | null = null;

/** 获取全局 EventBus 单例 */
export function getEventBus(): EventBus {
  if (!_globalBus) {
    _globalBus = new EventBus();
  }
  return _globalBus;
}

/** 重置全局 EventBus（测试用） */
export function resetEventBus(): void {
  if (_globalBus) {
    _globalBus.removeAllListeners();
    _globalBus.clearHistory();
  }
  _globalBus = null;
}
