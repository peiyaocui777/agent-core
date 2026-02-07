/**
 * 定时调度器
 *
 * 提供 cron 风格的定时任务管理，用于自动化内容运营：
 * - 每天定时采集热点 → AI 生成内容 → 多平台发布
 * - 灵活配置执行时间和目标平台
 * - 任务历史记录和失败重试
 *
 * 使用方法：
 *   import { Scheduler, createAgent } from "@jarvis/agent-core";
 *
 *   const agent = createAgent(config);
 *   const scheduler = new Scheduler(agent);
 *
 *   scheduler.addJob({
 *     id: "daily-xhs",
 *     cron: "0 9 * * *",  // 每天 9:00
 *     instruction: "帮我发一篇小红书关于AI的文章",
 *   });
 *
 *   scheduler.start();
 */

import { AgentCore } from "./agent.js";
import type { AgentTask } from "./types.js";

// ==================== 类型 ====================

export interface ScheduledJob {
  id: string;
  /** cron 表达式（简易版：支持 HH:MM 或 cron 5 段） */
  cron: string;
  /** 自然语言指令（传给 Agent.run()） */
  instruction: string;
  /** 是否启用 */
  enabled: boolean;
  /** 上次执行时间 */
  lastRun?: Date;
  /** 上次执行结果 */
  lastResult?: "success" | "failed";
  /** 执行历史 */
  history: JobExecution[];
}

export interface JobExecution {
  timestamp: Date;
  taskId: string;
  status: "success" | "failed";
  duration: number;
  error?: string;
}

export interface SchedulerConfig {
  /** 检查间隔（毫秒），默认 60000（1 分钟） */
  checkInterval?: number;
  /** 最大历史记录数，默认 100 */
  maxHistory?: number;
  /** 失败重试次数，默认 1 */
  retryCount?: number;
  /** 重试间隔（毫秒），默认 300000（5 分钟） */
  retryDelay?: number;
}

// ==================== Cron 解析器（简易版） ====================

function parseCron(cron: string): { hour: number; minute: number; daysOfWeek?: number[] } | null {
  // 支持简单格式：
  // "HH:MM" => 每天 HH:MM
  // "0 9 * * *" => 标准 cron（分 时 日 月 周）
  // "0 9 * * 1-5" => 工作日 9:00

  const simpleMatch = cron.match(/^(\d{1,2}):(\d{2})$/);
  if (simpleMatch) {
    return { hour: parseInt(simpleMatch[1]), minute: parseInt(simpleMatch[2]) };
  }

  const cronMatch = cron.match(/^(\d+)\s+(\d+)\s+\S+\s+\S+\s+(\S+)$/);
  if (cronMatch) {
    const minute = parseInt(cronMatch[1]);
    const hour = parseInt(cronMatch[2]);
    const dowStr = cronMatch[3];

    let daysOfWeek: number[] | undefined;
    if (dowStr !== "*") {
      const rangeMatch = dowStr.match(/^(\d)-(\d)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        daysOfWeek = [];
        for (let i = start; i <= end; i++) daysOfWeek.push(i);
      } else {
        daysOfWeek = dowStr.split(",").map((d) => parseInt(d.trim()));
      }
    }

    return { hour, minute, daysOfWeek };
  }

  return null;
}

function shouldRunNow(cron: string, lastRun?: Date): boolean {
  const parsed = parseCron(cron);
  if (!parsed) return false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // 检查时间是否匹配
  if (currentHour !== parsed.hour || currentMinute !== parsed.minute) {
    return false;
  }

  // 检查星期是否匹配
  if (parsed.daysOfWeek) {
    const currentDay = now.getDay(); // 0=周日
    if (!parsed.daysOfWeek.includes(currentDay)) {
      return false;
    }
  }

  // 检查是否已经在这分钟内执行过
  if (lastRun) {
    const diff = now.getTime() - lastRun.getTime();
    if (diff < 60000) return false; // 1 分钟内不重复执行
  }

  return true;
}

// ==================== Scheduler ====================

export class Scheduler {
  private agent: AgentCore;
  private jobs: Map<string, ScheduledJob> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: SchedulerConfig;
  private running = false;

  constructor(agent: AgentCore, config: SchedulerConfig = {}) {
    this.agent = agent;
    this.config = {
      checkInterval: config.checkInterval ?? 60000,
      maxHistory: config.maxHistory ?? 100,
      retryCount: config.retryCount ?? 1,
      retryDelay: config.retryDelay ?? 300000,
    };
  }

  /** 添加定时任务 */
  addJob(job: Omit<ScheduledJob, "enabled" | "history"> & { enabled?: boolean }): void {
    const parsed = parseCron(job.cron);
    if (!parsed) {
      throw new Error(`无效的 cron 表达式: ${job.cron}。支持 "HH:MM" 或 "分 时 * * 周"`);
    }

    this.jobs.set(job.id, {
      ...job,
      enabled: job.enabled ?? true,
      history: [],
    });

    console.log(`[Scheduler] 添加任务: ${job.id} (${job.cron}) → "${job.instruction}"`);
  }

  /** 移除任务 */
  removeJob(id: string): boolean {
    return this.jobs.delete(id);
  }

  /** 启用/禁用任务 */
  toggleJob(id: string, enabled: boolean): void {
    const job = this.jobs.get(id);
    if (job) job.enabled = enabled;
  }

  /** 获取所有任务 */
  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /** 手动触发任务 */
  async triggerJob(id: string): Promise<AgentTask> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`任务 "${id}" 不存在`);
    return this.executeJob(job);
  }

  /** 启动调度器 */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log(`[Scheduler] 启动，检查间隔: ${this.config.checkInterval}ms`);
    console.log(`[Scheduler] 已注册 ${this.jobs.size} 个任务`);

    this.timer = setInterval(() => this.check(), this.config.checkInterval!);
    // 立即检查一次
    this.check();
  }

  /** 停止调度器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log("[Scheduler] 已停止");
  }

  /** 检查并执行到期任务 */
  private async check(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (shouldRunNow(job.cron, job.lastRun)) {
        console.log(`[Scheduler] 触发任务: ${job.id}`);
        try {
          await this.executeJob(job);
        } catch (error) {
          console.error(`[Scheduler] 任务 ${job.id} 执行异常:`, error);
        }
      }
    }
  }

  /** 执行单个任务 */
  private async executeJob(job: ScheduledJob): Promise<AgentTask> {
    const startTime = Date.now();
    job.lastRun = new Date();

    let task: AgentTask;
    let retries = 0;
    const maxRetries = this.config.retryCount!;

    while (true) {
      task = await this.agent.run(job.instruction);

      if (task.status === "completed" || retries >= maxRetries) break;

      retries++;
      console.log(`[Scheduler] 任务 ${job.id} 失败，${retries}/${maxRetries} 次重试...`);
      await new Promise((resolve) => setTimeout(resolve, this.config.retryDelay!));
    }

    const duration = Date.now() - startTime;
    const execution: JobExecution = {
      timestamp: new Date(),
      taskId: task.id,
      status: task.status === "completed" ? "success" : "failed",
      duration,
      error: task.status === "failed"
        ? task.steps.find((s) => s.status === "failed")?.result?.error
        : undefined,
    };

    job.lastResult = execution.status;
    job.history.push(execution);

    // 限制历史记录数量
    if (job.history.length > this.config.maxHistory!) {
      job.history = job.history.slice(-this.config.maxHistory!);
    }

    console.log(`[Scheduler] 任务 ${job.id}: ${execution.status} (${duration}ms)`);
    return task;
  }
}
