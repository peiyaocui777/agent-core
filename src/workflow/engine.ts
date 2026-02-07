/**
 * Workflow Engine — Lobster-like 管道编排引擎
 *
 * 核心功能：
 * - 有向无环图（DAG）形式的管道执行
 * - 支持工具调用、条件分支、并行、审批、数据转换、延时、子管道
 * - 上下文持久化（JSON 文件）
 * - 参数映射（节点间数据传递）
 * - 重试 & 超时
 * - 管道暂停/恢复
 * - 事件驱动的进度反馈
 */

import type { AgentCore } from "../agent.js";
import type {
  PipelineDefinition,
  PipelineNode,
  PipelineContext,
  PipelineEvent,
  PipelineLog,
  ToolNodeConfig,
  ConditionNodeConfig,
  ParallelNodeConfig,
  ApprovalNodeConfig,
  TransformNodeConfig,
  DelayNodeConfig,
  NodeStatus,
} from "./types.js";

// ==================== 事件监听器 ====================

type PipelineEventListener = (event: PipelineEvent) => void;

// ==================== Workflow Engine ====================

export class WorkflowEngine {
  private agent: AgentCore;
  private pipelines: Map<string, PipelineDefinition> = new Map();
  private runs: Map<string, PipelineContext> = new Map();
  private listeners: PipelineEventListener[] = [];
  /** 审批回调 */
  private approvalCallbacks: Map<string, (approved: boolean) => void> = new Map();

  constructor(agent: AgentCore) {
    this.agent = agent;
  }

  // ==================== 管道注册 ====================

  /** 注册管道定义 */
  register(pipeline: PipelineDefinition): void {
    this.pipelines.set(pipeline.id, pipeline);
    console.log(`[Workflow] 注册管道: ${pipeline.name} (${pipeline.nodes.length} 个节点)`);
  }

  /** 注销管道 */
  unregister(pipelineId: string): boolean {
    return this.pipelines.delete(pipelineId);
  }

  /** 获取管道定义 */
  getPipeline(pipelineId: string): PipelineDefinition | undefined {
    return this.pipelines.get(pipelineId);
  }

  /** 列出所有管道 */
  listPipelines(): PipelineDefinition[] {
    return Array.from(this.pipelines.values());
  }

  // ==================== 事件系统 ====================

  on(listener: PipelineEventListener): void {
    this.listeners.push(listener);
  }

  off(listener: PipelineEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  // ==================== 管道执行 ====================

  /**
   * 执行管道
   * @param pipelineId 管道 ID
   * @param input 输入参数
   * @returns 执行上下文
   */
  async run(pipelineId: string, input?: Record<string, unknown>): Promise<PipelineContext> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`管道未找到: ${pipelineId}`);
    }

    // 创建执行上下文
    const ctx: PipelineContext = {
      pipelineId,
      runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      data: { ...pipeline.defaults, ...input },
      nodeStates: {},
      logs: [],
      startedAt: new Date(),
      status: "running",
    };

    // 重置所有节点状态
    for (const node of pipeline.nodes) {
      node.status = "idle";
      ctx.nodeStates[node.id] = "idle";
    }

    this.runs.set(ctx.runId, ctx);

    try {
      // 从入口节点开始执行
      await this.executeNode(pipeline, pipeline.entryNodeId, ctx);

      ctx.status = "completed";
      ctx.completedAt = new Date();
      this.emit({ type: "pipeline_completed", runId: ctx.runId, context: ctx });
    } catch (error) {
      ctx.status = "failed";
      ctx.completedAt = new Date();
      const errMsg = error instanceof Error ? error.message : String(error);
      this.emit({ type: "pipeline_failed", runId: ctx.runId, error: errMsg });
    }

    return ctx;
  }

  /** 恢复暂停的管道 */
  async resume(runId: string): Promise<PipelineContext | undefined> {
    const ctx = this.runs.get(runId);
    if (!ctx || ctx.status !== "paused") return undefined;

    const pipeline = this.pipelines.get(ctx.pipelineId);
    if (!pipeline) return undefined;

    ctx.status = "running";

    // 找到等待中的节点继续执行
    for (const node of pipeline.nodes) {
      if (ctx.nodeStates[node.id] === "waiting") {
        try {
          await this.executeNode(pipeline, node.id, ctx);
        } catch {
          ctx.status = "failed";
          break;
        }
      }
    }

    if (ctx.status === "running") {
      ctx.status = "completed";
      ctx.completedAt = new Date();
    }

    return ctx;
  }

  /** 处理审批 */
  handleApproval(runId: string, nodeId: string, approved: boolean): void {
    const key = `${runId}:${nodeId}`;
    const callback = this.approvalCallbacks.get(key);
    if (callback) {
      callback(approved);
      this.approvalCallbacks.delete(key);
    }
  }

  // ==================== 节点执行 ====================

  private async executeNode(
    pipeline: PipelineDefinition,
    nodeId: string,
    ctx: PipelineContext,
  ): Promise<void> {
    const node = pipeline.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`节点未找到: ${nodeId}`);
    }

    if (node.status === "completed" || node.status === "skipped") {
      return; // 已执行过
    }

    node.status = "running";
    ctx.nodeStates[nodeId] = "running";
    node.startedAt = new Date();

    this.emit({ type: "node_started", runId: ctx.runId, nodeId });
    this.log(ctx, nodeId, "info", `开始执行: ${node.name}`);

    try {
      // 根据节点类型分发
      switch (node.config.type) {
        case "tool":
          await this.executeToolNode(node, node.config, ctx);
          break;
        case "condition":
          await this.executeConditionNode(node, node.config, pipeline, ctx);
          break;
        case "parallel":
          await this.executeParallelNode(node, node.config, pipeline, ctx);
          break;
        case "approval":
          await this.executeApprovalNode(node, node.config, ctx);
          break;
        case "transform":
          await this.executeTransformNode(node, node.config, ctx);
          break;
        case "delay":
          await this.executeDelayNode(node, node.config, ctx);
          break;
        default:
          throw new Error(`不支持的节点类型: ${node.type}`);
      }

      node.status = "completed";
      ctx.nodeStates[nodeId] = "completed";
      node.completedAt = new Date();

      this.emit({ type: "node_completed", runId: ctx.runId, nodeId, result: node.result });
      this.log(ctx, nodeId, "info", `执行完成: ${node.name}`);

      // 执行后续节点
      const nextEdges = pipeline.edges.filter((e) => e.from === nodeId);
      for (const edge of nextEdges) {
        await this.executeNode(pipeline, edge.to, ctx);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 重试逻辑
      if (node.retry) {
        const attempt = (node.retry.currentAttempt || 0) + 1;
        if (attempt < node.retry.maxAttempts) {
          node.retry.currentAttempt = attempt;
          this.log(ctx, nodeId, "warn", `重试 (${attempt}/${node.retry.maxAttempts}): ${errMsg}`);
          await new Promise((r) => setTimeout(r, node.retry!.delayMs));
          node.status = "idle";
          return this.executeNode(pipeline, nodeId, ctx);
        }
      }

      node.status = "failed";
      ctx.nodeStates[nodeId] = "failed";
      node.error = errMsg;

      this.emit({ type: "node_failed", runId: ctx.runId, nodeId, error: errMsg });
      this.log(ctx, nodeId, "error", `执行失败: ${errMsg}`);

      throw error;
    }
  }

  // ==================== 各节点类型实现 ====================

  /** 工具节点 */
  private async executeToolNode(
    node: PipelineNode,
    config: ToolNodeConfig,
    ctx: PipelineContext,
  ): Promise<void> {
    // 构建参数
    const params: Record<string, unknown> = { ...config.params };

    // 参数映射
    if (config.paramMapping) {
      for (const [paramKey, contextPath] of Object.entries(config.paramMapping)) {
        params[paramKey] = this.resolveContextPath(ctx, contextPath);
      }
    }

    // 超时处理
    const resultPromise = this.agent.executeTool(config.toolName, params);
    let result;

    if (node.timeoutMs) {
      result = await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`工具 ${config.toolName} 超时 (${node.timeoutMs}ms)`)), node.timeoutMs)
        ),
      ]);
    } else {
      result = await resultPromise;
    }

    if (!result.success) {
      throw new Error(result.error || `工具 ${config.toolName} 执行失败`);
    }

    node.result = result.data;

    // 输出映射
    if (config.outputKey) {
      ctx.data[config.outputKey] = result.data;
    }
  }

  /** 条件节点 */
  private async executeConditionNode(
    node: PipelineNode,
    config: ConditionNodeConfig,
    pipeline: PipelineDefinition,
    ctx: PipelineContext,
  ): Promise<void> {
    // 安全地评估表达式
    let conditionResult = false;
    try {
      const fn = new Function("ctx", `return (${config.expression})`);
      conditionResult = !!fn(ctx.data);
    } catch (err) {
      this.log(ctx, node.id, "warn", `条件表达式执行失败: ${config.expression}`);
    }

    node.result = conditionResult;

    // 跳过未选中的分支
    const skipBranch = conditionResult ? config.falseBranch : config.trueBranch;
    const skipNode = pipeline.nodes.find((n) => n.id === skipBranch);
    if (skipNode) {
      skipNode.status = "skipped";
      ctx.nodeStates[skipBranch] = "skipped";
      this.emit({ type: "node_skipped", runId: ctx.runId, nodeId: skipBranch, reason: "条件分支未选中" });
    }

    // 执行选中的分支
    const targetBranch = conditionResult ? config.trueBranch : config.falseBranch;
    await this.executeNode(pipeline, targetBranch, ctx);
  }

  /** 并行节点 */
  private async executeParallelNode(
    node: PipelineNode,
    config: ParallelNodeConfig,
    pipeline: PipelineDefinition,
    ctx: PipelineContext,
  ): Promise<void> {
    const promises = config.nodeIds.map((nid) => this.executeNode(pipeline, nid, ctx));

    if (config.waitFor === "all") {
      await Promise.all(promises);
    } else {
      await Promise.race(promises);
    }

    node.result = config.nodeIds.map((nid) => ({
      nodeId: nid,
      status: ctx.nodeStates[nid],
    }));
  }

  /** 审批节点 */
  private async executeApprovalNode(
    node: PipelineNode,
    config: ApprovalNodeConfig,
    ctx: PipelineContext,
  ): Promise<void> {
    this.emit({
      type: "approval_required",
      runId: ctx.runId,
      nodeId: node.id,
      prompt: config.prompt,
    });

    const timeout = config.timeoutMs || 60000;

    const approved = await new Promise<boolean>((resolve) => {
      const key = `${ctx.runId}:${node.id}`;
      this.approvalCallbacks.set(key, resolve);

      // 超时自动处理
      setTimeout(() => {
        if (this.approvalCallbacks.has(key)) {
          this.approvalCallbacks.delete(key);
          resolve(config.defaultAction === "approve");
        }
      }, timeout);
    });

    if (!approved) {
      throw new Error("审批被拒绝");
    }

    node.result = { approved: true };
  }

  /** 数据转换节点 */
  private async executeTransformNode(
    node: PipelineNode,
    config: TransformNodeConfig,
    ctx: PipelineContext,
  ): Promise<void> {
    try {
      const fn = new Function("ctx", config.transformFn);
      const result = fn(ctx.data);
      node.result = result;
      ctx.data[config.outputKey] = result;
    } catch (err) {
      throw new Error(`数据转换失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 延时节点 */
  private async executeDelayNode(
    node: PipelineNode,
    config: DelayNodeConfig,
    ctx: PipelineContext,
  ): Promise<void> {
    this.log(ctx, node.id, "info", `延时 ${config.delayMs}ms`);
    await new Promise((r) => setTimeout(r, config.delayMs));
    node.result = { delayMs: config.delayMs };
  }

  // ==================== 辅助方法 ====================

  /** 解析上下文路径（支持点号嵌套，如 "research.topics[0]"） */
  private resolveContextPath(ctx: PipelineContext, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = ctx.data;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // 处理数组下标
      const match = part.match(/^(\w+)\[(\d+)\]$/);
      if (match) {
        current = (current as Record<string, unknown>)[match[1]];
        if (Array.isArray(current)) {
          current = current[parseInt(match[2])];
        }
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  /** 记录日志 */
  private log(ctx: PipelineContext, nodeId: string, level: PipelineLog["level"], message: string, data?: unknown): void {
    ctx.logs.push({ timestamp: new Date(), nodeId, level, message, data });
  }

  // ==================== 状态查询 ====================

  /** 获取运行实例 */
  getRun(runId: string): PipelineContext | undefined {
    return this.runs.get(runId);
  }

  /** 获取所有运行实例 */
  getAllRuns(): PipelineContext[] {
    return Array.from(this.runs.values());
  }

  /** 获取引擎状态 */
  getStatus(): {
    pipelines: number;
    activeRuns: number;
    completedRuns: number;
  } {
    const runs = Array.from(this.runs.values());
    return {
      pipelines: this.pipelines.size,
      activeRuns: runs.filter((r) => r.status === "running").length,
      completedRuns: runs.filter((r) => r.status === "completed").length,
    };
  }
}
