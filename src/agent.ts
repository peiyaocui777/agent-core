/**
 * AgentCore — AI 分身核心调度引擎（v2）
 *
 * 升级自 v1，集成：
 * - SkillRuntime: 技能管理（热加载 / 动态创建）
 * - MemoryStore: 持久化记忆
 * - IntentEngine: LLM Function Calling 意图识别
 *
 * 保持向后兼容：旧的 registerTool / executeTool API 仍可用
 */

import type {
  Tool,
  ToolParameter,
  ToolResult,
  ToolCategory,
  TaskStep,
  AgentTask,
  AgentConfig,
  ParsedIntent,
} from "./types.js";

import { SkillRuntime } from "./skills/runtime.js";
import { MemoryStore } from "./memory/store.js";
import { IntentEngine, type IntentEngineConfig, type ExecutionPlan } from "./intent/engine.js";
import type { SkillFactory, LoadedSkill } from "./skills/types.js";

export class AgentCore {
  /** 直接注册的工具（向后兼容） */
  private tools: Map<string, Tool> = new Map();
  /** 任务历史 */
  private tasks: Map<string, AgentTask> = new Map();
  /** 配置 */
  private config: AgentConfig;

  /** Skills 运行时 */
  readonly skills: SkillRuntime;
  /** 记忆系统 */
  readonly memory: MemoryStore;
  /** 意图引擎 */
  private intentEngine: IntentEngine;

  constructor(config: AgentConfig = {}, intentConfig?: IntentEngineConfig) {
    this.config = config;
    this.skills = new SkillRuntime(config);
    this.memory = new MemoryStore();
    this.intentEngine = new IntentEngine(config, intentConfig);
  }

  // ==================== 初始化 ====================

  /**
   * 完整初始化流程
   * 加载记忆 → 激活所有 Skill → 启动自动保存
   */
  async initialize(): Promise<void> {
    // 1. 加载记忆
    await this.memory.load();

    // 2. 激活所有已加载的 Skill
    await this.skills.activateAll();

    // 3. 启动记忆自动保存
    this.memory.startAutoSave();

    console.log(
      `[Agent] 初始化完成: ${this.skills.activeSkillCount} 个 Skill, ` +
        `${this.getAllToolsCount()} 个工具`
    );
  }

  /**
   * 优雅关闭
   */
  async shutdown(): Promise<void> {
    await this.memory.stopAutoSave();
    console.log("[Agent] 已关闭");
  }

  // ==================== 工具管理（向后兼容） ====================

  /** 注册工具（旧 API，保持兼容） */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
    console.log(`[Agent] 注册工具: ${tool.name} (${tool.category})`);
  }

  /** 批量注册工具 */
  registerTools(tools: Tool[]): void {
    tools.forEach((t) => this.registerTool(t));
  }

  /** 注销工具 */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  // ==================== Skill 管理 ====================

  /** 注册内置 Skill */
  registerSkill(factory: SkillFactory): void {
    this.skills.registerBundled(factory);
  }

  /** 批量注册内置 Skill */
  registerSkills(factories: SkillFactory[]): void {
    this.skills.registerBundledAll(factories);
  }

  /** 从目录加载 Skill */
  async loadSkillsFromDir(dir: string): Promise<string[]> {
    return this.skills.loadFromDirectory(dir);
  }

  // ==================== 工具获取（聚合 Skill + 直接注册） ====================

  /** 获取单个工具（先查 Skill，再查直接注册） */
  getTool(name: string): Tool | undefined {
    return this.skills.getTool(name) || this.tools.get(name);
  }

  /** 获取所有可用工具（Skill 工具 + 直接注册的工具） */
  getAllTools(): Tool[] {
    const skillTools = this.skills.getAllTools();
    const directTools = Array.from(this.tools.values());

    // 合并去重（Skill 工具优先）
    const seen = new Set(skillTools.map((t) => t.name));
    const merged = [...skillTools];

    for (const t of directTools) {
      if (!seen.has(t.name)) {
        merged.push(t);
        seen.add(t.name);
      }
    }

    return merged;
  }

  /** 获取所有工具描述（供 LLM function calling 使用） */
  getToolDescriptions(): {
    name: string;
    description: string;
    category: ToolCategory;
    parameters: Record<string, ToolParameter>;
  }[] {
    return this.getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: t.parameters,
    }));
  }

  /** 按分类获取工具 */
  getToolsByCategory(category: ToolCategory): Tool[] {
    return this.getAllTools().filter((t) => t.category === category);
  }

  private getAllToolsCount(): number {
    return this.getAllTools().length;
  }

  // ==================== 配置管理 ====================

  /** 获取当前配置 */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(partial: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ==================== 工具执行 ====================

  /** 执行单个工具 */
  async executeTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return { success: false, error: `工具 "${name}" 未注册` };
    }

    // 参数校验
    for (const [key, param] of Object.entries(tool.parameters)) {
      if (param.required && !(key in params)) {
        return { success: false, error: `缺少必填参数: ${key}` };
      }
    }

    try {
      const startTime = Date.now();
      const result = await tool.execute(params);
      result.metadata = {
        ...result.metadata,
        executionTime: Date.now() - startTime,
        toolName: name,
      };
      return result;
    } catch (error) {
      return {
        success: false,
        error: `工具 "${name}" 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ==================== 任务编排 ====================

  /** 执行多步骤任务（支持依赖链） */
  async executeTask(task: AgentTask): Promise<AgentTask> {
    this.tasks.set(task.id, task);
    task.status = "executing";

    for (const step of task.steps) {
      // 检查前置依赖是否全部完成
      if (step.dependsOn?.length) {
        const allDone = step.dependsOn.every((depId) => {
          const dep = task.steps.find((s) => s.id === depId);
          return dep?.status === "completed";
        });
        if (!allDone) {
          step.status = "skipped";
          step.result = { success: false, error: "前置步骤未完成，跳过此步骤" };
          continue;
        }

        // 注入前置步骤的结果作为参数
        for (const depId of step.dependsOn) {
          const dep = task.steps.find((s) => s.id === depId);
          if (dep?.result?.data) {
            step.params[`_from_${depId}`] = dep.result.data;
          }
        }
      }

      step.status = "running";
      step.result = await this.executeTool(step.toolName, step.params);
      step.status = step.result.success ? "completed" : "failed";

      // 步骤失败则标记任务失败并终止
      if (!step.result.success) {
        task.status = "failed";
        return task;
      }
    }

    task.status = "completed";
    task.completedAt = new Date();
    return task;
  }

  // ==================== 意图识别（v2: LLM + Fallback） ====================

  /**
   * 解析用户指令（v2）
   * 优先使用 LLM Function Calling，不可用时回退到正则
   */
  async parseInstruction(instruction: string): Promise<ExecutionPlan> {
    return this.intentEngine.parse(
      instruction,
      this.getAllTools(),
      this.memory
    );
  }

  /**
   * 旧版意图识别（保持向后兼容）
   * @deprecated 请使用 parseInstruction()
   */
  parseIntent(instruction: string): ParsedIntent {
    const normalized = instruction.toLowerCase();

    if (normalized.includes("小红书") && (normalized.includes("发") || normalized.includes("发布"))) {
      return {
        intent: "publish_xhs",
        platform: "xiaohongshu",
        topic: instruction.replace(/.*?(发布|发)\s*/, "").trim() || instruction,
        rawInstruction: instruction,
      };
    }

    if (normalized.includes("公众号") && (normalized.includes("发") || normalized.includes("发布"))) {
      return {
        intent: "publish_wechat",
        platform: "wechat",
        topic: instruction.replace(/.*?(发布|发)\s*/, "").trim() || instruction,
        rawInstruction: instruction,
      };
    }

    if (normalized.includes("搜索") || normalized.includes("热点")) {
      return { intent: "search", topic: instruction, rawInstruction: instruction };
    }

    if (normalized.includes("生成") || normalized.includes("写") || normalized.includes("创作")) {
      return { intent: "generate", topic: instruction, rawInstruction: instruction };
    }

    if (normalized.includes("工作流") || normalized.includes("自动")) {
      return { intent: "workflow", topic: instruction, rawInstruction: instruction };
    }

    return { intent: "unknown", topic: instruction, rawInstruction: instruction };
  }

  /** 根据旧版意图生成步骤（保持向后兼容） */
  intentToSteps(intent: ParsedIntent): TaskStep[] {
    switch (intent.intent) {
      case "publish_xhs":
        return [
          { id: "gen-content", toolName: "ai-generate-content", params: { topic: intent.topic }, status: "pending" },
          { id: "gen-image", toolName: "ai-generate-image", params: { prompt: `为以下内容配图: ${intent.topic}` }, status: "pending", dependsOn: ["gen-content"] },
          { id: "publish-xhs", toolName: "xhs-publish", params: {}, status: "pending", dependsOn: ["gen-content", "gen-image"] },
        ];
      case "publish_wechat":
        return [
          { id: "gen-content", toolName: "ai-generate-content", params: { topic: intent.topic }, status: "pending" },
          { id: "format-wechat", toolName: "wechat-format", params: {}, status: "pending", dependsOn: ["gen-content"] },
          { id: "publish-wechat", toolName: "wechat-publish", params: {}, status: "pending", dependsOn: ["format-wechat"] },
        ];
      case "search":
        return [{ id: "search", toolName: "xhs-search", params: { keyword: intent.topic }, status: "pending" }];
      case "generate":
        return [{ id: "gen-content", toolName: "ai-generate-content", params: { topic: intent.topic }, status: "pending" }];
      case "workflow":
        return [{ id: "trigger", toolName: "trigger-workflow", params: { workflowType: "daily" }, status: "pending" }];
      default:
        return [{ id: "gen-content", toolName: "ai-generate-content", params: { topic: intent.topic || intent.rawInstruction }, status: "pending" }];
    }
  }

  // ==================== 高级入口（v2） ====================

  /**
   * 自然语言 → LLM 意图识别 → 任务编排 → 执行
   *
   * 这是主入口，升级后的版本：
   * 1. 记录用户消息到 Memory
   * 2. 使用 LLM Function Calling 解析意图
   * 3. 生成并执行任务
   * 4. 记录结果到 Memory
   */
  async run(instruction: string): Promise<AgentTask> {
    // 1. 记录用户消息
    this.memory.addMessage({ role: "user", content: instruction });

    // 2. 解析意图
    let plan: ExecutionPlan;
    try {
      plan = await this.parseInstruction(instruction);
    } catch {
      // 完全回退到旧逻辑
      const intent = this.parseIntent(instruction);
      plan = {
        instruction,
        steps: this.intentToSteps(intent),
        reasoning: "旧版正则匹配",
        fromLLM: false,
      };
    }

    // 3. 构建任务
    const task: AgentTask = {
      id: `task-${Date.now()}`,
      userInstruction: instruction,
      steps: plan.steps,
      status: "planning",
      createdAt: new Date(),
    };

    // 如果没有步骤（闲聊），标记完成
    if (task.steps.length === 0) {
      task.status = "completed";
      task.completedAt = new Date();
      this.tasks.set(task.id, task);

      // 记录 AI 回复
      this.memory.addMessage({
        role: "assistant",
        content: plan.reasoning || "好的，有什么可以帮你的？",
      });

      return task;
    }

    // 4. 执行任务
    const result = await this.executeTask(task);

    // 5. 记录结果到 Memory
    const summary = result.status === "completed"
      ? `已完成: ${result.steps.map((s) => s.toolName).join(" → ")}`
      : `执行失败: ${result.steps.find((s) => s.status === "failed")?.result?.error || "未知错误"}`;

    this.memory.addMessage({ role: "assistant", content: summary });

    // 6. 如果是发布操作，记录到发布历史
    for (const step of result.steps) {
      if (
        step.status === "completed" &&
        (step.toolName.includes("publish") || step.toolName.includes("multi-publish"))
      ) {
        this.memory.logPublish({
          platform: step.params.platform as string || step.toolName,
          title: (step.params.title as string) || instruction,
          status: "success",
          metadata: step.result?.data as Record<string, unknown>,
        });
      }
    }

    return result;
  }

  // ==================== 任务历史 ====================

  /** 获取任务历史 */
  getTaskHistory(): AgentTask[] {
    return Array.from(this.tasks.values());
  }

  /** 获取单个任务 */
  getTask(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  // ==================== 状态概览 ====================

  /** 获取 Agent 完整状态 */
  getStatus(): {
    skills: { total: number; active: number };
    tools: number;
    memory: { memories: number; publishHistory: number };
    tasks: number;
  } {
    return {
      skills: {
        total: this.skills.skillCount,
        active: this.skills.activeSkillCount,
      },
      tools: this.getAllToolsCount(),
      memory: {
        memories: this.memory.exportData().memories.length,
        publishHistory: this.memory.exportData().publishHistory.length,
      },
      tasks: this.tasks.size,
    };
  }
}
