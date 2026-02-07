/**
 * CronMaestro — 自然语言定时调度引擎
 *
 * 将自然语言时间表达式转换为 Cron 任务
 *
 * 参考: OpenClaw Heartbeat + Cron
 */

import * as fs from "fs";

// ==================== 类型 ====================

export interface ScheduledTask {
  id: string;
  /** 原始自然语言描述 */
  description: string;
  /** 解析后的 Cron 表达式 */
  cronExpression: string;
  /** 要执行的指令 */
  instruction: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后执行时间 */
  lastRunAt?: string;
  /** 下次执行时间 */
  nextRunAt?: string;
  /** 执行次数 */
  runCount: number;
  /** 状态 */
  status: "active" | "paused" | "completed" | "error";
  /** 最多执行次数（0=无限） */
  maxRuns: number;
  /** 最后执行结果 */
  lastResult?: string;
}

export interface CronMaestroConfig {
  /** 任务持久化路径 */
  dataPath: string;
  /** 检查间隔（ms） */
  checkInterval: number;
  /** 任务执行回调 */
  onExecute?: (task: ScheduledTask) => Promise<string>;
}

// ==================== 自然语言→Cron 转换 ====================

interface TimePattern {
  pattern: RegExp;
  toCron: (match: RegExpMatchArray) => string;
  description: string;
}

const TIME_PATTERNS: TimePattern[] = [
  // "工作日"（必须在"每天"之前匹配）
  {
    pattern: /工作日\s*(?:每天)?\s*(?:上午|早上)?\s*(\d{1,2})\s*(?:点|:)\s*(\d{0,2})/,
    toCron: (m) => `${m[2] || "0"} ${m[1]} * * 1-5`,
    description: "工作日每天",
  },
  // "每天早上/上午X点"
  {
    pattern: /每天\s*(?:早上|上午|早)\s*(\d{1,2})\s*(?:点|:00)/,
    toCron: (m) => `0 ${m[1]} * * *`,
    description: "每天固定时间",
  },
  // "每天下午/晚上X点"
  {
    pattern: /每天\s*(?:下午|晚上|晚)\s*(\d{1,2})\s*(?:点|:00)/,
    toCron: (m) => {
      const h = parseInt(m[1]);
      return `0 ${h <= 12 ? h + 12 : h} * * *`;
    },
    description: "每天固定时间(下午)",
  },
  // "每天X点"
  {
    pattern: /每天\s*(\d{1,2})\s*(?:点|:)\s*(\d{0,2})/,
    toCron: (m) => `${m[2] || "0"} ${m[1]} * * *`,
    description: "每天X点Y分",
  },
  // "每隔X分钟"
  {
    pattern: /每隔?\s*(\d+)\s*分钟/,
    toCron: (m) => `*/${m[1]} * * * *`,
    description: "每隔N分钟",
  },
  // "每隔X小时"
  {
    pattern: /每隔?\s*(\d+)\s*(?:小时|个小时)/,
    toCron: (m) => `0 */${m[1]} * * *`,
    description: "每隔N小时",
  },
  // "每小时"
  {
    pattern: /每\s*(?:小时|个小时)/,
    toCron: () => "0 * * * *",
    description: "每整点",
  },
  // "每周X"
  {
    pattern: /每\s*(?:周|星期)\s*(一|二|三|四|五|六|日|天)/,
    toCron: (m) => {
      const dayMap: Record<string, string> = {
        一: "1", 二: "2", 三: "3", 四: "4",
        五: "5", 六: "6", 日: "0", 天: "0",
      };
      return `0 9 * * ${dayMap[m[1]] || "1"}`;
    },
    description: "每周固定某天",
  },
  // "每周X下午Y点"
  {
    pattern: /每\s*(?:周|星期)\s*(一|二|三|四|五|六|日|天)\s*(?:下午|晚上)?\s*(\d{1,2})\s*点/,
    toCron: (m) => {
      const dayMap: Record<string, string> = {
        一: "1", 二: "2", 三: "3", 四: "4",
        五: "5", 六: "6", 日: "0", 天: "0",
      };
      return `0 ${m[2]} * * ${dayMap[m[1]] || "1"}`;
    },
    description: "每周某天某时",
  },
  // "每月X号"
  {
    pattern: /每月\s*(\d{1,2})\s*(?:号|日)/,
    toCron: (m) => `0 9 ${m[1]} * *`,
    description: "每月固定日期",
  },
  // "每月X号Y点"
  {
    pattern: /每月\s*(\d{1,2})\s*(?:号|日)\s*(\d{1,2})\s*点/,
    toCron: (m) => `0 ${m[2]} ${m[1]} * *`,
    description: "每月固定日期时间",
  },
  // "每X天"
  {
    pattern: /每\s*(\d+)\s*天/,
    toCron: (m) => `0 9 */${m[1]} * *`,
    description: "每N天",
  },
];

// ==================== CronMaestro ====================

export class CronMaestro {
  private config: CronMaestroConfig;
  private tasks: Map<string, ScheduledTask> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<CronMaestroConfig>) {
    this.config = {
      dataPath: "/tmp/jarvis-cron-tasks.json",
      checkInterval: 60000, // 1 分钟
      ...config,
    };
    this.load();
  }

  // ==================== 自然语言解析 ====================

  /**
   * 将自然语言时间表达式解析为 Cron 表达式
   */
  parseNaturalLanguage(text: string): {
    cronExpression: string | null;
    matched: string;
    description: string;
  } {
    for (const pattern of TIME_PATTERNS) {
      const match = text.match(pattern.pattern);
      if (match) {
        return {
          cronExpression: pattern.toCron(match),
          matched: match[0],
          description: pattern.description,
        };
      }
    }

    // 尝试直接作为 Cron 表达式
    if (/^[\d*\/\-,]+\s+[\d*\/\-,]+\s+[\d*\/\-,]+\s+[\d*\/\-,]+\s+[\d*\/\-,]+$/.test(text.trim())) {
      return {
        cronExpression: text.trim(),
        matched: text.trim(),
        description: "直接 Cron 表达式",
      };
    }

    return { cronExpression: null, matched: "", description: "无法解析" };
  }

  // ==================== 任务管理 ====================

  /**
   * 创建定时任务（自然语言）
   */
  createTask(
    naturalTime: string,
    instruction: string,
    options?: { maxRuns?: number }
  ): ScheduledTask | null {
    const parsed = this.parseNaturalLanguage(naturalTime);
    if (!parsed.cronExpression) return null;

    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: ScheduledTask = {
      id,
      description: naturalTime,
      cronExpression: parsed.cronExpression,
      instruction,
      createdAt: new Date().toISOString(),
      runCount: 0,
      status: "active",
      maxRuns: options?.maxRuns || 0,
      nextRunAt: this.getNextRunTime(parsed.cronExpression)?.toISOString(),
    };

    this.tasks.set(id, task);
    this.save();
    return task;
  }

  /**
   * 直接用 Cron 表达式创建任务
   */
  createTaskWithCron(
    cronExpression: string,
    instruction: string,
    description?: string
  ): ScheduledTask {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: ScheduledTask = {
      id,
      description: description || cronExpression,
      cronExpression,
      instruction,
      createdAt: new Date().toISOString(),
      runCount: 0,
      status: "active",
      maxRuns: 0,
      nextRunAt: this.getNextRunTime(cronExpression)?.toISOString(),
    };

    this.tasks.set(id, task);
    this.save();
    return task;
  }

  /** 暂停任务 */
  pauseTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.status = "paused";
    this.save();
    return true;
  }

  /** 恢复任务 */
  resumeTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "paused") return false;
    task.status = "active";
    task.nextRunAt = this.getNextRunTime(task.cronExpression)?.toISOString();
    this.save();
    return true;
  }

  /** 删除任务 */
  deleteTask(id: string): boolean {
    const deleted = this.tasks.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  /** 获取任务 */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /** 列出所有任务 */
  listTasks(status?: ScheduledTask["status"]): ScheduledTask[] {
    const all = Array.from(this.tasks.values());
    if (status) return all.filter((t) => t.status === status);
    return all;
  }

  // ==================== 调度引擎 ====================

  /**
   * 启动调度循环
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.tick();
    }, this.config.checkInterval);

    // 立即执行一次检查
    this.tick();
  }

  /** 停止调度 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 单次检查 — 执行到期的任务 */
  private async tick(): Promise<void> {
    const now = new Date();

    for (const task of this.tasks.values()) {
      if (task.status !== "active") continue;
      if (!task.nextRunAt) continue;

      const nextRun = new Date(task.nextRunAt);
      if (now >= nextRun) {
        await this.executeTask(task);
      }
    }
  }

  /** 执行单个任务 */
  private async executeTask(task: ScheduledTask): Promise<void> {
    try {
      let result = "执行完成";
      if (this.config.onExecute) {
        result = await this.config.onExecute(task);
      }

      task.lastRunAt = new Date().toISOString();
      task.lastResult = result;
      task.runCount++;

      // 检查是否达到最大执行次数
      if (task.maxRuns > 0 && task.runCount >= task.maxRuns) {
        task.status = "completed";
        task.nextRunAt = undefined;
      } else {
        task.nextRunAt = this.getNextRunTime(task.cronExpression)?.toISOString();
      }

      this.save();
    } catch (error) {
      task.status = "error";
      task.lastResult = `错误: ${error instanceof Error ? error.message : String(error)}`;
      this.save();
    }
  }

  // ==================== Cron 解析 ====================

  /**
   * 简易 Cron 解析 — 获取下次执行时间
   * 格式: minute hour dayOfMonth month dayOfWeek
   */
  getNextRunTime(cronExpr: string): Date | null {
    try {
      const parts = cronExpr.trim().split(/\s+/);
      if (parts.length !== 5) return null;

      const now = new Date();
      const candidate = new Date(now);
      candidate.setSeconds(0);
      candidate.setMilliseconds(0);

      // 向前推进最多 7 天寻找下一个匹配时间
      for (let i = 0; i < 7 * 24 * 60; i++) {
        candidate.setMinutes(candidate.getMinutes() + 1);

        if (
          this.matchField(parts[0], candidate.getMinutes(), 0, 59) &&
          this.matchField(parts[1], candidate.getHours(), 0, 23) &&
          this.matchField(parts[2], candidate.getDate(), 1, 31) &&
          this.matchField(parts[3], candidate.getMonth() + 1, 1, 12) &&
          this.matchField(parts[4], candidate.getDay(), 0, 6)
        ) {
          return candidate;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 匹配 Cron 字段
   */
  private matchField(field: string, value: number, min: number, max: number): boolean {
    if (field === "*") return true;

    // */N
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2));
      return value % step === 0;
    }

    // N-M (范围)
    if (field.includes("-")) {
      const [start, end] = field.split("-").map(Number);
      return value >= start && value <= end;
    }

    // N,M,... (列表)
    if (field.includes(",")) {
      return field.split(",").map(Number).includes(value);
    }

    // 直接数字
    return parseInt(field) === value;
  }

  // ==================== 状态 ====================

  getStatus(): {
    totalTasks: number;
    active: number;
    paused: number;
    completed: number;
    isRunning: boolean;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      totalTasks: tasks.length,
      active: tasks.filter((t) => t.status === "active").length,
      paused: tasks.filter((t) => t.status === "paused").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      isRunning: this.timer !== null,
    };
  }

  // ==================== 持久化 ====================

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = fs.readFileSync(this.config.dataPath, "utf-8");
        const arr: ScheduledTask[] = JSON.parse(raw);
        for (const task of arr) {
          this.tasks.set(task.id, task);
        }
      }
    } catch {
      // ignore
    }
  }

  private save(): void {
    try {
      const dir = require("path").dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.config.dataPath,
        JSON.stringify(Array.from(this.tasks.values()), null, 2)
      );
    } catch {
      // ignore
    }
  }
}
