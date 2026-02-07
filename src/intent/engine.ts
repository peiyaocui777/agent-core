/**
 * LLM Intent Engine — 基于 Function Calling 的意图识别引擎
 *
 * 替代原来的正则匹配意图识别。
 *
 * 工作流程：
 * 1. 收集所有已激活 Skill 的 Tool 描述
 * 2. 构建 LLM Function Calling 请求（tools 参数）
 * 3. LLM 返回需要调用的工具和参数
 * 4. 生成执行计划（TaskStep[]）
 *
 * 支持：
 * - 单工具调用：用户简单指令 → 单个工具
 * - 多工具编排：复杂指令 → 多步骤执行计划
 * - Fallback：LLM 不可用时回退到正则匹配
 */

import type { Tool, ToolParameter, TaskStep, AgentConfig } from "../types.js";
import { LLMClient, createLLMClient, type LLMMessage } from "../providers/llm.js";
import type { MemoryStore } from "../memory/store.js";

// ==================== 类型 ====================

/** LLM Function Calling 中的 Tool 定义（OpenAI 格式） */
interface FunctionDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

/** LLM 返回的工具调用 */
interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** 意图引擎配置 */
export interface IntentEngineConfig {
  /** 系统提示词（追加到默认 system prompt 后） */
  systemPromptExtra?: string;
  /** 最大工具调用轮次 */
  maxRounds?: number;
  /** 是否启用多步编排（复杂指令自动拆成多步骤） */
  enableMultiStep?: boolean;
}

/** 解析后的执行计划 */
export interface ExecutionPlan {
  /** 用户原始指令 */
  instruction: string;
  /** LLM 生成的步骤 */
  steps: TaskStep[];
  /** LLM 的分析/解释 */
  reasoning?: string;
  /** 是否由 LLM 生成（false = fallback） */
  fromLLM: boolean;
}

// ==================== Intent Engine ====================

export class IntentEngine {
  private llm: LLMClient | null = null;
  private config: IntentEngineConfig;

  constructor(
    agentConfig: AgentConfig,
    engineConfig: IntentEngineConfig = {}
  ) {
    this.llm = createLLMClient(agentConfig);
    this.config = {
      maxRounds: engineConfig.maxRounds ?? 3,
      enableMultiStep: engineConfig.enableMultiStep ?? true,
      systemPromptExtra: engineConfig.systemPromptExtra ?? "",
    };
  }

  /**
   * 解析用户指令为执行计划
   *
   * @param instruction 用户自然语言指令
   * @param tools 当前可用工具列表
   * @param memory 记忆系统（可选，用于注入上下文）
   */
  async parse(
    instruction: string,
    tools: Tool[],
    memory?: MemoryStore
  ): Promise<ExecutionPlan> {
    // 如果 LLM 不可用，回退到正则
    if (!this.llm) {
      return this.fallbackParse(instruction, tools);
    }

    try {
      return await this.llmParse(instruction, tools, memory);
    } catch (error) {
      console.error("[IntentEngine] LLM 解析失败，回退到正则:", error);
      return this.fallbackParse(instruction, tools);
    }
  }

  // ==================== LLM 解析 ====================

  private async llmParse(
    instruction: string,
    tools: Tool[],
    memory?: MemoryStore
  ): Promise<ExecutionPlan> {
    const systemPrompt = this.buildSystemPrompt(tools, memory);
    const functionDefs = this.buildFunctionDefs(tools);

    // 如果启用多步编排，使用规划模式
    if (this.config.enableMultiStep) {
      return this.llmPlanParse(instruction, tools, systemPrompt, functionDefs, memory);
    }

    // 简单模式：直接 Function Calling
    return this.llmDirectParse(instruction, systemPrompt, functionDefs);
  }

  /**
   * 直接 Function Calling
   * 适用于简单指令，LLM 直接返回要调用的工具
   */
  private async llmDirectParse(
    instruction: string,
    systemPrompt: string,
    functionDefs: FunctionDef[]
  ): Promise<ExecutionPlan> {
    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: instruction },
    ];

    // 使用 LLM 原生 Function Calling
    const url = `${this.llm!.getInfo().baseUrl}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(this.llm! as unknown as { apiKey: string }).apiKey}`,
      },
      body: JSON.stringify({
        model: this.llm!.getInfo().model,
        messages,
        tools: functionDefs,
        tool_choice: "auto",
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API 错误 [${response.status}]`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: ToolCall[];
        };
      }>;
    };

    const message = data.choices[0]?.message;
    const toolCalls = message?.tool_calls || [];

    if (toolCalls.length === 0) {
      // LLM 没有选择任何工具，可能是闲聊
      return {
        instruction,
        steps: [],
        reasoning: message?.content || "无需执行工具",
        fromLLM: true,
      };
    }

    // 转换为 TaskStep
    const steps: TaskStep[] = toolCalls.map((tc, idx) => {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(tc.function.arguments);
      } catch {
        params = {};
      }

      return {
        id: `step-${idx + 1}`,
        toolName: tc.function.name,
        params,
        status: "pending" as const,
        dependsOn: idx > 0 ? [`step-${idx}`] : undefined,
      };
    });

    return {
      instruction,
      steps,
      reasoning: message?.content || undefined,
      fromLLM: true,
    };
  }

  /**
   * 规划模式
   * 适用于复杂指令，LLM 先分析再编排多步骤
   */
  private async llmPlanParse(
    instruction: string,
    tools: Tool[],
    systemPrompt: string,
    _functionDefs: FunctionDef[],
    memory?: MemoryStore
  ): Promise<ExecutionPlan> {
    const planPrompt = `${systemPrompt}

## 任务
分析用户指令，规划执行步骤。

## 可用工具
${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

## 输出格式
严格按 JSON 输出：
{
  "reasoning": "你的分析过程",
  "steps": [
    {
      "toolName": "工具名",
      "params": { "参数名": "值" },
      "dependsOn": ["前置步骤ID"] // 可选
    }
  ]
}

注意：
- 步骤 ID 自动按顺序生成（step-1, step-2, ...）
- 如果后续步骤需要前置步骤结果，在 dependsOn 中引用
- 尽量简洁，不要生成不必要的步骤
- 如果指令无需工具，返回空 steps 数组${memory ? `\n\n## 用户上下文\n${memory.getProfilePrompt()}` : ""}`;

    const result = await this.llm!.completeJSON<{
      reasoning: string;
      steps: Array<{
        toolName: string;
        params: Record<string, unknown>;
        dependsOn?: string[];
      }>;
    }>(
      `用户指令：${instruction}\n\n请分析并规划执行步骤。`,
      { temperature: 0.3, maxTokens: 2000 }
    );

    const steps: TaskStep[] = result.steps.map((s, idx) => ({
      id: `step-${idx + 1}`,
      toolName: s.toolName,
      params: s.params,
      status: "pending" as const,
      dependsOn: s.dependsOn,
    }));

    return {
      instruction,
      steps,
      reasoning: result.reasoning,
      fromLLM: true,
    };
  }

  // ==================== Fallback 正则解析 ====================

  /**
   * 正则匹配回退方案
   * 当 LLM 不可用或调用失败时使用
   */
  private fallbackParse(instruction: string, tools: Tool[]): ExecutionPlan {
    const lower = instruction.toLowerCase();
    const steps: TaskStep[] = [];

    // 检测是否包含"发布"意图
    const wantPublish =
      lower.includes("发") ||
      lower.includes("发布") ||
      lower.includes("publish");

    // 检测目标平台
    const wantXhs = lower.includes("小红书") || lower.includes("xhs");
    const wantWechat = lower.includes("公众号") || lower.includes("微信");
    const wantAll =
      lower.includes("全") ||
      lower.includes("所有") ||
      lower.includes("多平台");

    // 检测采集意图
    const wantScrape =
      lower.includes("热点") ||
      lower.includes("采集") ||
      lower.includes("搜索") ||
      lower.includes("trending");

    // 检测生成意图
    const wantGenerate =
      lower.includes("生成") ||
      lower.includes("写") ||
      lower.includes("创作");

    // 提取主题
    const topic = instruction
      .replace(
        /帮我|请|发布|发|一篇|关于|的|文章|笔记|小红书|公众号|微信|xhs|写|生成|创作|热点|采集|搜索/g,
        ""
      )
      .trim() || instruction;

    // 构建步骤链
    if (wantScrape && this.hasTool(tools, "scrape-trending")) {
      steps.push({
        id: "step-1",
        toolName: "scrape-trending",
        params: { domain: "all", count: 5 },
        status: "pending",
      });
    }

    if ((wantGenerate || wantPublish) && this.hasTool(tools, "ai-generate-content")) {
      const platform = wantXhs ? "xhs" : wantWechat ? "wechat" : "general";
      steps.push({
        id: `step-${steps.length + 1}`,
        toolName: "ai-generate-content",
        params: { topic, platform },
        status: "pending",
        dependsOn: steps.length > 0 ? [steps[steps.length - 1].id] : undefined,
      });
    }

    if (wantPublish && wantAll && this.hasTool(tools, "multi-publish")) {
      steps.push({
        id: `step-${steps.length + 1}`,
        toolName: "multi-publish",
        params: {
          title: topic,
          content: topic,
          platforms: ["xiaohongshu", "wechat"],
        },
        status: "pending",
        dependsOn: steps.length > 0 ? [steps[steps.length - 1].id] : undefined,
      });
    } else if (wantPublish && wantXhs && this.hasTool(tools, "xhs-publish")) {
      steps.push({
        id: `step-${steps.length + 1}`,
        toolName: "xhs-publish",
        params: { title: topic, content: topic },
        status: "pending",
        dependsOn: steps.length > 0 ? [steps[steps.length - 1].id] : undefined,
      });
    } else if (wantPublish && wantWechat && this.hasTool(tools, "wechat-publish")) {
      steps.push({
        id: `step-${steps.length + 1}`,
        toolName: "wechat-publish",
        params: { title: topic, content: topic },
        status: "pending",
        dependsOn: steps.length > 0 ? [steps[steps.length - 1].id] : undefined,
      });
    }

    // 默认：如果没有匹配到任何工具，尝试生成内容
    if (steps.length === 0 && this.hasTool(tools, "ai-generate-content")) {
      steps.push({
        id: "step-1",
        toolName: "ai-generate-content",
        params: { topic: instruction },
        status: "pending",
      });
    }

    return {
      instruction,
      steps,
      reasoning: "正则匹配（LLM 不可用）",
      fromLLM: false,
    };
  }

  private hasTool(tools: Tool[], name: string): boolean {
    return tools.some((t) => t.name === name);
  }

  // ==================== System Prompt 构建 ====================

  private buildSystemPrompt(tools: Tool[], memory?: MemoryStore): string {
    let prompt = `你是 Jarvis —— 一个智能内容运营助手。你的职责是帮助用户完成内容采集、生成、发布等工作。

## 核心原则
1. 理解用户意图，选择最合适的工具
2. 如果需要多步操作，合理编排执行顺序
3. 如果用户意图不清楚，优先选择"生成内容"
4. 保持简洁高效，不要生成冗余步骤`;

    // 注入用户画像
    if (memory) {
      const profilePrompt = memory.getProfilePrompt();
      if (profilePrompt) {
        prompt += `\n\n${profilePrompt}`;
      }
    }

    // 追加自定义提示
    if (this.config.systemPromptExtra) {
      prompt += `\n\n${this.config.systemPromptExtra}`;
    }

    return prompt;
  }

  // ==================== Function Defs 构建 ====================

  /** 将 Tool 参数转换为 OpenAI Function Calling 格式 */
  private buildFunctionDefs(tools: Tool[]): FunctionDef[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object" as const,
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              {
                type: this.mapParamType(param.type),
                description: param.description,
              },
            ])
          ),
          required: Object.entries(tool.parameters)
            .filter(([_, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));
  }

  private mapParamType(type: ToolParameter["type"]): string {
    switch (type) {
      case "string":
        return "string";
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return "array";
      case "object":
        return "object";
      default:
        return "string";
    }
  }
}
