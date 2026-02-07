/**
 * NotificationCenter — 通知中心
 *
 * 统一管理 Agent 的各类通知：
 * 1. 任务完成通知
 * 2. 错误/异常告警
 * 3. 定时提醒
 * 4. 系统状态变更
 * 5. 多渠道推送（内存/WebSocket/Telegram/Webhook）
 */

import * as fs from "fs";
import * as path from "path";

// ==================== 类型 ====================

export type NotificationType = "info" | "success" | "warning" | "error" | "reminder" | "task";

export type NotificationChannel = "internal" | "websocket" | "telegram" | "webhook";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  timestamp: string;
  source?: string;
  metadata?: Record<string, unknown>;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface NotificationRule {
  id: string;
  event: string;       // 匹配事件名
  type: NotificationType;
  titleTemplate: string;
  messageTemplate: string;
  channels: NotificationChannel[];
  enabled: boolean;
}

export interface NotificationCenterConfig {
  dataPath: string;
  maxNotifications: number;
  channels: NotificationChannel[];
  webhookUrl?: string;
  telegramChatId?: string;
}

// ==================== NotificationCenter ====================

export class NotificationCenter {
  private config: NotificationCenterConfig;
  private notifications: Notification[] = [];
  private rules: NotificationRule[] = [];

  /** 推送回调（由外部设置，如 WebSocket） */
  private pushHandlers: Map<NotificationChannel, (n: Notification) => void> = new Map();

  constructor(config?: Partial<NotificationCenterConfig>) {
    this.config = {
      dataPath: "/tmp/jarvis-notifications.json",
      maxNotifications: 500,
      channels: ["internal"],
      ...config,
    };
    this.initDefaultRules();
    this.load();
  }

  // ==================== 发送通知 ====================

  /** 发送通知 */
  notify(
    type: NotificationType,
    title: string,
    message: string,
    options?: {
      source?: string;
      metadata?: Record<string, unknown>;
      actions?: NotificationAction[];
      channels?: NotificationChannel[];
    }
  ): Notification {
    const notification: Notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      message,
      read: false,
      timestamp: new Date().toISOString(),
      source: options?.source,
      metadata: options?.metadata,
      actions: options?.actions,
    };

    this.notifications.push(notification);

    // 限制数量
    if (this.notifications.length > this.config.maxNotifications) {
      this.notifications = this.notifications.slice(-this.config.maxNotifications);
    }

    // 推送到各渠道
    const channels = options?.channels || this.config.channels;
    for (const ch of channels) {
      const handler = this.pushHandlers.get(ch);
      if (handler) {
        try { handler(notification); } catch { /* ignore */ }
      }
    }

    this.save();
    return notification;
  }

  /** 快捷：成功通知 */
  success(title: string, message: string, source?: string): Notification {
    return this.notify("success", title, message, { source });
  }

  /** 快捷：错误通知 */
  error(title: string, message: string, source?: string): Notification {
    return this.notify("error", title, message, { source });
  }

  /** 快捷：警告通知 */
  warning(title: string, message: string, source?: string): Notification {
    return this.notify("warning", title, message, { source });
  }

  /** 快捷：任务通知 */
  task(title: string, message: string, actions?: NotificationAction[]): Notification {
    return this.notify("task", title, message, { actions });
  }

  /** 快捷：提醒 */
  reminder(title: string, message: string): Notification {
    return this.notify("reminder", title, message);
  }

  // ==================== 事件触发 ====================

  /** 根据事件名自动匹配规则并发送通知 */
  triggerByEvent(eventName: string, data?: Record<string, unknown>): Notification | null {
    const rule = this.rules.find((r) => r.enabled && this.matchEvent(r.event, eventName));
    if (!rule) return null;

    const title = this.applyTemplate(rule.titleTemplate, data);
    const message = this.applyTemplate(rule.messageTemplate, data);

    return this.notify(rule.type, title, message, {
      source: eventName,
      metadata: data,
      channels: rule.channels,
    });
  }

  // ==================== 查询 ====================

  getAll(limit = 50): Notification[] {
    return this.notifications.slice(-limit).reverse();
  }

  getUnread(): Notification[] {
    return this.notifications.filter((n) => !n.read).reverse();
  }

  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  getByType(type: NotificationType, limit = 20): Notification[] {
    return this.notifications.filter((n) => n.type === type).slice(-limit).reverse();
  }

  // ==================== 管理 ====================

  markRead(id: string): boolean {
    const n = this.notifications.find((n) => n.id === id);
    if (!n) return false;
    n.read = true;
    this.save();
    return true;
  }

  markAllRead(): void {
    for (const n of this.notifications) n.read = true;
    this.save();
  }

  delete(id: string): boolean {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    this.notifications.splice(idx, 1);
    this.save();
    return true;
  }

  clear(): void {
    this.notifications = [];
    this.save();
  }

  // ==================== 渠道注册 ====================

  registerChannel(channel: NotificationChannel, handler: (n: Notification) => void): void {
    this.pushHandlers.set(channel, handler);
  }

  // ==================== 规则管理 ====================

  addRule(rule: NotificationRule): void {
    this.rules.push(rule);
  }

  getRules(): NotificationRule[] {
    return this.rules;
  }

  // ==================== 内部 ====================

  private initDefaultRules(): void {
    this.rules = [
      {
        id: "rule-publish-success",
        event: "publish:success",
        type: "success",
        titleTemplate: "发布成功",
        messageTemplate: "内容已成功发布到 {{platform}}",
        channels: ["internal"],
        enabled: true,
      },
      {
        id: "rule-publish-fail",
        event: "publish:error",
        type: "error",
        titleTemplate: "发布失败",
        messageTemplate: "发布到 {{platform}} 失败: {{error}}",
        channels: ["internal"],
        enabled: true,
      },
      {
        id: "rule-task-complete",
        event: "task:completed",
        type: "success",
        titleTemplate: "任务完成",
        messageTemplate: "任务「{{taskName}}」已执行完毕",
        channels: ["internal"],
        enabled: true,
      },
      {
        id: "rule-safety-block",
        event: "safety:blocked",
        type: "warning",
        titleTemplate: "内容被拦截",
        messageTemplate: "内容未通过安全检查: {{reason}}",
        channels: ["internal"],
        enabled: true,
      },
      {
        id: "rule-memory-milestone",
        event: "memory:milestone",
        type: "info",
        titleTemplate: "记忆里程碑",
        messageTemplate: "已累计 {{count}} 条记忆",
        channels: ["internal"],
        enabled: true,
      },
    ];
  }

  private matchEvent(pattern: string, eventName: string): boolean {
    if (pattern === eventName) return true;
    if (pattern.endsWith("*")) {
      return eventName.startsWith(pattern.slice(0, -1));
    }
    return false;
  }

  private applyTemplate(template: string, data?: Record<string, unknown>): string {
    if (!data) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? key));
  }

  // ==================== 持久化 ====================

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = JSON.parse(fs.readFileSync(this.config.dataPath, "utf-8"));
        this.notifications = raw.notifications || [];
      }
    } catch {
      this.notifications = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.config.dataPath, JSON.stringify({ notifications: this.notifications }));
    } catch { /* ignore */ }
  }
}
