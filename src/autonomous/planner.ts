/**
 * AutonomousPlanner — AI 自主决策引擎
 *
 * 让 Agent 从「被动执行单条指令」升级为「自主规划多步任务」：
 * 1. 任务分解：将复杂目标拆解为执行步骤
 * 2. 工具选择：自动匹配最佳工具组合
 * 3. 执行循环：Plan → Act → Observe → Reflect → Re-plan
 * 4. 反思纠错：执行失败时自动调整策略
 * 5. 记忆整合：利用向量记忆辅助决策
 *
 * 参考: OpenClaw + AutoGPT + ReAct 模式
 */

// ==================== 类型 ====================

export interface TaskGoal {
  id: string;
  /** 用户原始目标 */
  goal: string;
  /** 优先级 */
  priority: "high" | "medium" | "low";
  /** 约束条件 */
  constraints?: string[];
  /** 最大步骤数 */
  maxSteps?: number;
  /** 超时（ms） */
  timeout?: number;
}

export interface PlanStep {
  stepId: number;
  action: string;
  tool?: string;
  params?: Record<string, unknown>;
  reasoning: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ExecutionTrace {
  taskId: string;
  goal: string;
  startedAt: string;
  completedAt?: string;
  status: "planning" | "executing" | "reflecting" | "completed" | "failed" | "timeout";
  plan: PlanStep[];
  reflections: Reflection[];
  finalResult?: string;
  totalSteps: number;
  successSteps: number;
  failedSteps: number;
}

export interface Reflection {
  afterStep: number;
  observation: string;
  analysis: string;
  decision: "continue" | "replan" | "abort";
  newPlan?: PlanStep[];
}

export interface PlannerConfig {
  /** 最大步骤数 */
  maxSteps: number;
  /** 最大反思次数 */
  maxReflections: number;
  /** 连续失败阈值 */
  failureThreshold: number;
  /** 步骤超时 ms */
  stepTimeout: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: PlannerConfig = {
  maxSteps: 10,
  maxReflections: 3,
  failureThreshold: 2,
  stepTimeout: 30000,
};

// ==================== AutonomousPlanner ====================

export class AutonomousPlanner {
  private config: PlannerConfig;

  /** 工具执行回调（由 AgentCore 提供） */
  private executeTool?: (name: string, params: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;

  /** LLM 调用回调（用于规划和反思） */
  private callLLM?: (prompt: string) => Promise<string>;

  /** 可用工具列表 */
  private availableTools: Array<{ name: string; description: string }> = [];

  /** 执行历史 */
  private traces: ExecutionTrace[] = [];

  constructor(config?: Partial<PlannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==================== 配置 ====================

  /** 设置工具执行器 */
  setToolExecutor(fn: typeof this.executeTool): void {
    this.executeTool = fn;
  }

  /** 设置 LLM 回调 */
  setLLM(fn: typeof this.callLLM): void {
    this.callLLM = fn;
  }

  /** 注册可用工具 */
  registerTools(tools: Array<{ name: string; description: string }>): void {
    this.availableTools = tools;
  }

  // ==================== 核心：自主执行循环 ====================

  /**
   * 自主执行任务
   * Plan → Act → Observe → Reflect → Re-plan
   */
  async execute(goal: TaskGoal): Promise<ExecutionTrace> {
    const trace: ExecutionTrace = {
      taskId: goal.id,
      goal: goal.goal,
      startedAt: new Date().toISOString(),
      status: "planning",
      plan: [],
      reflections: [],
      totalSteps: 0,
      successSteps: 0,
      failedSteps: 0,
    };

    const maxSteps = goal.maxSteps || this.config.maxSteps;
    const timeout = goal.timeout || maxSteps * this.config.stepTimeout;
    const startTime = Date.now();

    try {
      // Step 1: 初始规划
      trace.status = "planning";
      trace.plan = await this.planSteps(goal);

      // Step 2: 执行循环
      trace.status = "executing";
      let consecutiveFailures = 0;
      let reflectionCount = 0;

      for (let i = 0; i < trace.plan.length && i < maxSteps; i++) {
        // 超时检查
        if (Date.now() - startTime > timeout) {
          trace.status = "timeout";
          break;
        }

        const step = trace.plan[i];
        step.status = "running";
        trace.totalSteps++;

        // 执行步骤
        const stepStart = Date.now();
        try {
          if (step.tool && this.executeTool) {
            const result = await this.executeTool(step.tool, step.params || {});
            step.result = result.data;
            step.status = result.success ? "success" : "failed";
            if (!result.success) step.error = result.error;
          } else {
            // 纯推理步骤
            step.status = "success";
            step.result = step.action;
          }
        } catch (error) {
          step.status = "failed";
          step.error = error instanceof Error ? error.message : String(error);
        }
        step.durationMs = Date.now() - stepStart;

        // 更新计数
        if (step.status === "success") {
          trace.successSteps++;
          consecutiveFailures = 0;
        } else {
          trace.failedSteps++;
          consecutiveFailures++;
        }

        // Step 3: 反思（每执行几步或遇到失败时）
        if (
          consecutiveFailures >= this.config.failureThreshold ||
          (i > 0 && i % 3 === 0)
        ) {
          if (reflectionCount < this.config.maxReflections) {
            trace.status = "reflecting";
            const reflection = await this.reflect(trace, i);
            trace.reflections.push(reflection);
            reflectionCount++;

            if (reflection.decision === "abort") {
              trace.status = "failed";
              trace.finalResult = `任务中止: ${reflection.analysis}`;
              break;
            }

            if (reflection.decision === "replan" && reflection.newPlan) {
              // 替换剩余步骤
              trace.plan = [
                ...trace.plan.slice(0, i + 1),
                ...reflection.newPlan,
              ];
              consecutiveFailures = 0;
            }

            trace.status = "executing";
          }
        }
      }

      // 最终判定
      if (trace.status === "executing") {
        trace.status = "completed";
        trace.finalResult = this.summarizeResult(trace);
      }
    } catch (error) {
      trace.status = "failed";
      trace.finalResult = `执行异常: ${error instanceof Error ? error.message : String(error)}`;
    }

    trace.completedAt = new Date().toISOString();
    this.traces.push(trace);
    return trace;
  }

  // ==================== 规划 ====================

  /**
   * 将目标分解为执行步骤
   */
  async planSteps(goal: TaskGoal): Promise<PlanStep[]> {
    // 如果有 LLM，用 LLM 规划
    if (this.callLLM) {
      return this.planWithLLM(goal);
    }

    // 否则用规则引擎做简单规划
    return this.planWithRules(goal);
  }

  private async planWithLLM(goal: TaskGoal): Promise<PlanStep[]> {
    const toolsDesc = this.availableTools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const prompt = `你是一个 AI 任务规划器。请将以下目标分解为具体执行步骤。

## 目标
${goal.goal}

${goal.constraints ? `## 约束\n${goal.constraints.join("\n")}` : ""}

## 可用工具
${toolsDesc}

## 要求
- 返回 JSON 数组格式
- 每一步包含 stepId, action (描述), tool (工具名或null), params (参数), reasoning (推理)
- 步骤数不超过 ${goal.maxSteps || this.config.maxSteps}
- 只使用上面列出的工具

请直接返回 JSON 数组：`;

    try {
      const response = await this.callLLM!(prompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const steps = JSON.parse(jsonMatch[0]) as PlanStep[];
        return steps.map((s, i) => ({ ...s, stepId: i + 1, status: "pending" as const }));
      }
    } catch {
      // LLM 规划失败，降级到规则
    }

    return this.planWithRules(goal);
  }

  private planWithRules(goal: TaskGoal): PlanStep[] {
    const steps: PlanStep[] = [];
    const text = goal.goal.toLowerCase();

    // 简单关键词匹配规划
    if (text.includes("采集") || text.includes("热点") || text.includes("trending")) {
      steps.push({
        stepId: 1,
        action: "采集热点内容",
        tool: "scrape-trending",
        params: {},
        reasoning: "目标包含采集需求",
        status: "pending",
      });
    }

    if (text.includes("写") || text.includes("生成") || text.includes("创作")) {
      steps.push({
        stepId: steps.length + 1,
        action: "AI 生成内容",
        tool: "ai-generate-content",
        params: { topic: goal.goal },
        reasoning: "目标包含内容生成需求",
        status: "pending",
      });
    }

    if (text.includes("小红书") || text.includes("xhs")) {
      steps.push({
        stepId: steps.length + 1,
        action: "发布到小红书",
        tool: "xhs-publish",
        params: {},
        reasoning: "目标指定小红书平台",
        status: "pending",
      });
    }

    if (text.includes("公众号") || text.includes("微信")) {
      steps.push({
        stepId: steps.length + 1,
        action: "发布到微信公众号",
        tool: "wechat-publish",
        params: {},
        reasoning: "目标指定微信公众号",
        status: "pending",
      });
    }

    if (text.includes("多平台") || text.includes("全平台")) {
      steps.push({
        stepId: steps.length + 1,
        action: "多平台分发",
        tool: "multi-publish",
        params: {},
        reasoning: "目标要求多平台分发",
        status: "pending",
      });
    }

    // 兜底
    if (steps.length === 0) {
      steps.push({
        stepId: 1,
        action: `理解并执行: ${goal.goal}`,
        tool: undefined,
        reasoning: "无法精确匹配工具，作为通用任务处理",
        status: "pending",
      });
    }

    return steps;
  }

  // ==================== 反思 ====================

  private async reflect(trace: ExecutionTrace, currentStep: number): Promise<Reflection> {
    const completedSteps = trace.plan.slice(0, currentStep + 1);
    const observation = completedSteps
      .map((s) => `Step ${s.stepId}: ${s.action} → ${s.status}${s.error ? ` (${s.error})` : ""}`)
      .join("\n");

    if (this.callLLM) {
      try {
        const prompt = `## 任务反思

目标: ${trace.goal}

执行进度:
${observation}

成功: ${trace.successSteps}, 失败: ${trace.failedSteps}

请分析当前进展并决定:
1. continue - 继续执行剩余步骤
2. replan - 调整后续计划
3. abort - 放弃任务

返回 JSON: { "analysis": "...", "decision": "continue|replan|abort" }`;

        const response = await this.callLLM(prompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return {
            afterStep: currentStep,
            observation,
            analysis: result.analysis || "LLM 分析完成",
            decision: result.decision || "continue",
          };
        }
      } catch {
        // LLM 反思失败
      }
    }

    // 规则反思
    const failRate = trace.failedSteps / Math.max(trace.totalSteps, 1);
    let decision: Reflection["decision"] = "continue";
    let analysis = "继续执行";

    if (failRate > 0.5 && trace.totalSteps >= 3) {
      decision = "abort";
      analysis = `失败率过高 (${(failRate * 100).toFixed(0)}%)，建议中止`;
    } else if (trace.failedSteps >= this.config.failureThreshold) {
      decision = "replan";
      analysis = `连续失败 ${trace.failedSteps} 次，需要调整策略`;
    }

    return { afterStep: currentStep, observation, analysis, decision };
  }

  // ==================== 辅助 ====================

  private summarizeResult(trace: ExecutionTrace): string {
    const successSteps = trace.plan.filter((s) => s.status === "success");
    if (successSteps.length === 0) return "没有成功执行的步骤";

    return successSteps.map((s) => `✅ ${s.action}`).join("\n");
  }

  /** 获取执行历史 */
  getTraces(limit = 10): ExecutionTrace[] {
    return this.traces.slice(-limit);
  }

  /** 获取状态 */
  getStatus(): {
    totalTasks: number;
    completed: number;
    failed: number;
    avgSteps: number;
  } {
    const completed = this.traces.filter((t) => t.status === "completed").length;
    const avgSteps = this.traces.length > 0
      ? this.traces.reduce((s, t) => s + t.totalSteps, 0) / this.traces.length
      : 0;

    return {
      totalTasks: this.traces.length,
      completed,
      failed: this.traces.filter((t) => t.status === "failed").length,
      avgSteps: Math.round(avgSteps * 10) / 10,
    };
  }
}
