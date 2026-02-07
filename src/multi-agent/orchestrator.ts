/**
 * Multi-Agent Orchestrator — 多角色编排引擎
 *
 * 核心功能：
 * - 根据用户指令自动规划协作流程
 * - 支持多种编排策略（顺序/并行/审阅循环/自适应）
 * - Agent 间消息传递 & 上下文共享
 * - 审阅与打回机制
 * - 事件驱动的进度反馈
 */

import type { AgentCore } from "../agent.js";
import type { Tool, ToolResult, TaskStep } from "../types.js";
import type {
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
import { ALL_ROLES, getRole } from "./roles.js";

// ==================== 事件监听器 ====================

type EventListener = (event: OrchestratorEvent) => void;

// ==================== Orchestrator ====================

export class Orchestrator {
  private agent: AgentCore;
  private config: OrchestratorConfig;
  private roles: Map<string, AgentRole> = new Map();
  private messages: AgentMessage[] = [];
  private tasks: Map<string, CollaborationTask> = new Map();
  private listeners: EventListener[] = [];
  private msgCounter = 0;

  constructor(agent: AgentCore, config?: Partial<OrchestratorConfig>) {
    this.agent = agent;
    this.config = {
      strategy: "review_loop",
      maxReviewRounds: 3,
      humanApproval: false,
      approvalTimeout: 60000,
      ...config,
    };

    // 注册默认角色
    for (const role of Object.values(ALL_ROLES)) {
      this.roles.set(role.id, role);
    }
  }

  // ==================== 角色管理 ====================

  /** 注册自定义角色 */
  registerRole(role: AgentRole): void {
    this.roles.set(role.id, role);
  }

  /** 获取所有已注册角色 */
  listRoles(): AgentRole[] {
    return Array.from(this.roles.values());
  }

  /** 获取角色 */
  getRole(id: string): AgentRole | undefined {
    return this.roles.get(id);
  }

  // ==================== 事件系统 ====================

  /** 监听事件 */
  on(listener: EventListener): void {
    this.listeners.push(listener);
  }

  /** 移除监听器 */
  off(listener: EventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private emit(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[Orchestrator] 事件处理异常:", err);
      }
    }
  }

  // ==================== 消息系统 ====================

  /** 发送 Agent 间消息 */
  private sendMessage(
    from: AgentRoleId,
    to: AgentRoleId,
    type: MessageType,
    content: string,
    payload?: Record<string, unknown>,
    taskId?: string,
  ): AgentMessage {
    const msg: AgentMessage = {
      id: `msg-${++this.msgCounter}`,
      from,
      to,
      type,
      content,
      payload,
      taskId,
      timestamp: new Date(),
    };
    this.messages.push(msg);
    this.emit({ type: "message", message: msg });
    return msg;
  }

  /** 获取消息历史 */
  getMessages(taskId?: string): AgentMessage[] {
    if (taskId) {
      return this.messages.filter((m) => m.taskId === taskId);
    }
    return [...this.messages];
  }

  // ==================== 核心编排 ====================

  /**
   * 执行协作任务
   * 根据指令自动规划 → 分配角色 → 顺序执行 → 审阅循环
   */
  async execute(instruction: string): Promise<CollaborationTask> {
    // 1. 规划任务
    const task = this.planTask(instruction);
    this.tasks.set(task.id, task);

    // 2. 按策略执行
    try {
      switch (this.config.strategy) {
        case "sequential":
          await this.executeSequential(task);
          break;
        case "parallel":
          await this.executeParallel(task);
          break;
        case "review_loop":
          await this.executeReviewLoop(task);
          break;
        case "adaptive":
          await this.executeAdaptive(task);
          break;
      }

      task.status = "completed";
      task.completedAt = new Date();
      this.emit({ type: "task_completed", taskId: task.id, result: task });
    } catch (error) {
      task.status = "failed";
      const errMsg = error instanceof Error ? error.message : String(error);
      this.emit({ type: "task_failed", taskId: task.id, error: errMsg });
    }

    return task;
  }

  /** 根据用户指令自动规划协作任务 */
  private planTask(instruction: string): CollaborationTask {
    const taskId = `collab-${Date.now()}`;
    const normalized = instruction.toLowerCase();

    // 自动检测任务类型
    let type: CollaborationTask["type"] = "content_pipeline";
    if (normalized.includes("分析") || normalized.includes("数据")) {
      type = "review_pipeline";
    } else if (normalized.includes("发布") || normalized.includes("推送")) {
      type = "publish_pipeline";
    }

    // 根据类型生成阶段
    const phases = this.planPhases(type, instruction, taskId);

    return {
      id: taskId,
      instruction,
      type,
      phases,
      status: "planning",
      createdAt: new Date(),
      context: { instruction },
    };
  }

  /** 根据任务类型生成阶段 */
  private planPhases(
    type: CollaborationTask["type"],
    instruction: string,
    taskId: string,
  ): CollaborationPhase[] {
    switch (type) {
      case "content_pipeline":
        return [
          {
            id: `${taskId}-research`,
            name: "热点采集与选题",
            assignedTo: "writer",
            status: "pending",
            steps: [
              {
                id: "research-1",
                toolName: "scrape-trending",
                params: { topic: instruction },
                status: "pending",
              },
            ],
            maxRetries: 2,
          },
          {
            id: `${taskId}-write`,
            name: "内容撰写",
            assignedTo: "writer",
            status: "pending",
            dependsOn: [`${taskId}-research`],
            steps: [
              {
                id: "write-1",
                toolName: "ai-generate-content",
                params: { topic: instruction },
                status: "pending",
              },
              {
                id: "write-2",
                toolName: "ai-generate-image",
                params: { prompt: instruction },
                status: "pending",
              },
            ],
            maxRetries: 2,
          },
          {
            id: `${taskId}-review`,
            name: "内容审阅",
            assignedTo: "editor",
            status: "pending",
            dependsOn: [`${taskId}-write`],
            steps: [
              {
                id: "review-1",
                toolName: "ai-generate-content",
                params: {
                  topic: `审阅以下内容，给出评分和修改建议：\n\n{content}`,
                  type: "review",
                },
                status: "pending",
              },
            ],
            maxRetries: 1,
          },
          {
            id: `${taskId}-publish`,
            name: "多平台发布",
            assignedTo: "publisher",
            status: "pending",
            dependsOn: [`${taskId}-review`],
            steps: [
              {
                id: "publish-1",
                toolName: "multi-publish",
                params: { platforms: ["xiaohongshu", "wechat"] },
                status: "pending",
              },
            ],
            maxRetries: 1,
          },
        ];

      case "publish_pipeline":
        return [
          {
            id: `${taskId}-format`,
            name: "内容格式化",
            assignedTo: "publisher",
            status: "pending",
            steps: [
              {
                id: "format-1",
                toolName: "xhs-format",
                params: { content: instruction },
                status: "pending",
              },
            ],
          },
          {
            id: `${taskId}-publish`,
            name: "执行发布",
            assignedTo: "publisher",
            status: "pending",
            dependsOn: [`${taskId}-format`],
            steps: [
              {
                id: "publish-1",
                toolName: "multi-publish",
                params: { platforms: ["xiaohongshu"] },
                status: "pending",
              },
            ],
          },
        ];

      case "review_pipeline":
        return [
          {
            id: `${taskId}-analyze`,
            name: "数据采集",
            assignedTo: "analyst",
            status: "pending",
            steps: [
              {
                id: "analyze-1",
                toolName: "scrape-trending",
                params: { topic: instruction },
                status: "pending",
              },
            ],
          },
          {
            id: `${taskId}-report`,
            name: "分析报告",
            assignedTo: "analyst",
            status: "pending",
            dependsOn: [`${taskId}-analyze`],
            steps: [
              {
                id: "report-1",
                toolName: "ai-generate-content",
                params: { topic: `数据分析报告: ${instruction}`, type: "analysis" },
                status: "pending",
              },
            ],
          },
        ];

      default:
        return [
          {
            id: `${taskId}-exec`,
            name: "执行任务",
            assignedTo: "coordinator",
            status: "pending",
            steps: [
              {
                id: "exec-1",
                toolName: "ai-generate-content",
                params: { topic: instruction },
                status: "pending",
              },
            ],
          },
        ];
    }
  }

  // ==================== 编排策略实现 ====================

  /** 顺序执行 */
  private async executeSequential(task: CollaborationTask): Promise<void> {
    task.status = "executing";

    for (const phase of task.phases) {
      // 检查依赖
      if (phase.dependsOn?.length) {
        const depsOk = phase.dependsOn.every((depId) => {
          const dep = task.phases.find((p) => p.id === depId);
          return dep?.status === "completed" || dep?.status === "approved";
        });

        if (!depsOk) {
          phase.status = "failed";
          throw new Error(`阶段 "${phase.name}" 依赖未满足`);
        }

        // 注入上一阶段输出
        this.injectPhaseInput(task, phase);
      }

      await this.executePhase(task, phase);

      if (phase.status === "failed") {
        throw new Error(`阶段 "${phase.name}" 执行失败`);
      }
    }
  }

  /** 并行执行（无依赖的阶段并行） */
  private async executeParallel(task: CollaborationTask): Promise<void> {
    task.status = "executing";

    // 拓扑排序找出可并行的层
    const layers = this.topologicalSort(task.phases);

    for (const layer of layers) {
      await Promise.all(
        layer.map(async (phase) => {
          this.injectPhaseInput(task, phase);
          await this.executePhase(task, phase);
        })
      );

      // 检查是否有失败
      const failed = layer.find((p) => p.status === "failed");
      if (failed) {
        throw new Error(`阶段 "${failed.name}" 执行失败`);
      }
    }
  }

  /** 审阅循环（写手 → 编辑 → 可能打回 → 再写 → 编辑 → 通过 → 发布） */
  private async executeReviewLoop(task: CollaborationTask): Promise<void> {
    task.status = "executing";
    const maxRounds = this.config.maxReviewRounds || 3;
    let round = 0;

    for (let i = 0; i < task.phases.length; i++) {
      const phase = task.phases[i];

      // 检查依赖
      if (phase.dependsOn?.length) {
        const depsOk = phase.dependsOn.every((depId) => {
          const dep = task.phases.find((p) => p.id === depId);
          return dep?.status === "completed" || dep?.status === "approved";
        });

        if (!depsOk) {
          phase.status = "failed";
          throw new Error(`阶段 "${phase.name}" 依赖未满足`);
        }

        this.injectPhaseInput(task, phase);
      }

      await this.executePhase(task, phase);

      if (phase.status === "failed") {
        throw new Error(`阶段 "${phase.name}" 执行失败`);
      }

      // 如果是审阅阶段，检查是否需要打回
      if (phase.assignedTo === "editor" && phase.output) {
        const reviewResult = phase.output as Record<string, unknown>;
        const approved = reviewResult["approved"] !== false;

        if (!approved && round < maxRounds) {
          round++;
          console.log(
            `[Orchestrator] 编辑打回 (第 ${round}/${maxRounds} 轮): ${reviewResult["feedback"] || "需要修改"}`
          );

          // 发送打回消息
          this.sendMessage(
            "editor",
            "writer",
            "review_feedback",
            String(reviewResult["feedback"] || "请修改后重新提交"),
            reviewResult,
            task.id,
          );

          // 找到写作阶段，重置后重新执行
          const writePhase = task.phases.find(
            (p) => p.assignedTo === "writer" && p.name.includes("撰写")
          );
          if (writePhase) {
            writePhase.status = "pending";
            writePhase.retryCount = (writePhase.retryCount || 0) + 1;
            writePhase.output = undefined;

            // 将编辑反馈注入写作阶段
            writePhase.input = {
              ...writePhase.input,
              feedback: reviewResult["feedback"],
              previousContent: writePhase.output,
            };

            // 重置后续阶段
            phase.status = "pending";
            phase.output = undefined;

            // 回退到写作阶段重新执行
            i = task.phases.indexOf(writePhase) - 1;
            continue;
          }
        } else {
          // 通过审阅
          phase.status = "approved";
          this.sendMessage(
            "editor",
            "publisher",
            "handoff",
            "内容已通过审阅，请发布",
            { content: task.context },
            task.id,
          );
        }
      }
    }
  }

  /** 自适应编排（简化版，后续可接入 LLM） */
  private async executeAdaptive(task: CollaborationTask): Promise<void> {
    // 当前用 review_loop 代替，后续接入 LLM 实现智能编排
    await this.executeReviewLoop(task);
  }

  // ==================== 阶段执行 ====================

  /** 执行单个阶段 */
  private async executePhase(task: CollaborationTask, phase: CollaborationPhase): Promise<void> {
    const role = this.roles.get(phase.assignedTo);
    if (!role) {
      phase.status = "failed";
      throw new Error(`未知角色: ${phase.assignedTo}`);
    }

    phase.status = "in_progress";
    phase.startedAt = new Date();

    this.emit({
      type: "phase_started",
      taskId: task.id,
      phaseId: phase.id,
      role: phase.assignedTo,
    });

    // 发送任务分配消息
    this.sendMessage(
      "coordinator",
      phase.assignedTo,
      "task_assign",
      `请执行: ${phase.name}`,
      { phaseInput: phase.input },
      task.id,
    );

    // 执行阶段中的每个步骤
    for (const step of phase.steps) {
      // 注入上下文参数
      if (phase.input) {
        step.params = { ...step.params, ...this.flattenForTool(phase.input) };
      }

      step.status = "running";
      step.result = await this.agent.executeTool(step.toolName, step.params);
      step.status = step.result.success ? "completed" : "failed";

      if (!step.result.success) {
        phase.status = "failed";
        this.emit({
          type: "phase_failed",
          taskId: task.id,
          phaseId: phase.id,
          role: phase.assignedTo,
          error: step.result.error || "步骤执行失败",
        });
        return;
      }
    }

    // 收集阶段输出
    const lastStep = phase.steps[phase.steps.length - 1];
    phase.output = {
      result: lastStep?.result?.data,
      allResults: phase.steps.map((s) => ({ tool: s.toolName, data: s.result?.data })),
    };

    // 存入全局上下文
    task.context[phase.id] = phase.output;
    task.context[`${phase.assignedTo}_output`] = phase.output;

    phase.status = "completed";
    phase.completedAt = new Date();

    // 发送完成消息
    this.sendMessage(
      phase.assignedTo,
      "coordinator",
      "task_result",
      `${phase.name} 已完成`,
      phase.output,
      task.id,
    );

    this.emit({
      type: "phase_completed",
      taskId: task.id,
      phaseId: phase.id,
      role: phase.assignedTo,
      output: phase.output,
    });
  }

  // ==================== 辅助方法 ====================

  /** 注入上一阶段的输出作为当前阶段的输入 */
  private injectPhaseInput(task: CollaborationTask, phase: CollaborationPhase): void {
    if (!phase.dependsOn?.length) return;

    const input: Record<string, unknown> = {};
    for (const depId of phase.dependsOn) {
      const dep = task.phases.find((p) => p.id === depId);
      if (dep?.output) {
        input[depId] = dep.output;
        // 展平常用字段
        if (typeof dep.output === "object") {
          Object.assign(input, dep.output);
        }
      }
    }
    phase.input = { ...input, ...phase.input };
  }

  /** 展平对象用于工具参数 */
  private flattenForTool(obj: Record<string, unknown>): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        flat[key] = val;
      }
    }
    return flat;
  }

  /** 拓扑排序：将阶段分层（用于并行执行） */
  private topologicalSort(phases: CollaborationPhase[]): CollaborationPhase[][] {
    const layers: CollaborationPhase[][] = [];
    const done = new Set<string>();

    while (done.size < phases.length) {
      const layer = phases.filter((p) => {
        if (done.has(p.id)) return false;
        const deps = p.dependsOn || [];
        return deps.every((d) => done.has(d));
      });

      if (layer.length === 0) {
        // 防止死循环
        const remaining = phases.filter((p) => !done.has(p.id));
        layers.push(remaining);
        break;
      }

      layers.push(layer);
      layer.forEach((p) => done.add(p.id));
    }

    return layers;
  }

  // ==================== 状态查询 ====================

  /** 获取任务状态 */
  getTask(taskId: string): CollaborationTask | undefined {
    return this.tasks.get(taskId);
  }

  /** 获取所有任务 */
  getAllTasks(): CollaborationTask[] {
    return Array.from(this.tasks.values());
  }

  /** 获取编排器状态摘要 */
  getStatus(): {
    roles: number;
    activeTasks: number;
    completedTasks: number;
    messages: number;
    strategy: OrchestrationStrategy;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      roles: this.roles.size,
      activeTasks: tasks.filter((t) => t.status === "executing").length,
      completedTasks: tasks.filter((t) => t.status === "completed").length,
      messages: this.messages.length,
      strategy: this.config.strategy,
    };
  }
}
