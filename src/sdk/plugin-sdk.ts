/**
 * Plugin SDK — 第三方 Skill 开发者套件
 *
 * 提供标准化接口，让第三方开发者可以：
 * 1. 快速创建 Skill 包
 * 2. 定义工具 + 参数验证
 * 3. 生命周期钩子
 * 4. 测试框架
 * 5. 打包发布辅助
 *
 * 参考: LobeChat Plugin SDK
 */

import type { Tool, ToolResult, AgentConfig } from "../types.js";
import type { SkillMeta, SkillFactory, Skill } from "../skills/types.js";
import { defineSkill } from "../skills/define.js";

// ==================== SDK 类型 ====================

/** 工具定义（SDK 简化格式） */
export interface ToolDefinition {
  name: string;
  description: string;
  category?: string;
  /** 参数 schema（简化格式） */
  params: Record<string, {
    type: "string" | "number" | "boolean" | "array" | "object";
    description: string;
    required?: boolean;
    default?: unknown;
    enum?: unknown[];
  }>;
  /** 工具实现 */
  handler: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

/** 工具执行上下文 */
export interface ToolContext {
  /** Agent 配置 */
  config: AgentConfig;
  /** 日志 */
  log: (message: string) => void;
  /** 发送事件 */
  emit?: (event: string, data: unknown) => void;
}

/** Skill 定义（SDK 格式） */
export interface PluginDefinition {
  /** 基本信息 */
  name: string;
  version: string;
  description: string;
  author: string;
  /** 分类 */
  category?: SkillMeta["category"];
  /** 标签 */
  tags?: string[];
  /** 触发词 */
  triggers?: string[];
  /** 权限需求 */
  permissions?: SkillMeta["permissions"];
  /** 配置要求 */
  configKeys?: string[];
  /** 工具列表 */
  tools: ToolDefinition[];
  /** 生命周期 */
  onActivate?: (config: AgentConfig) => Promise<void>;
  onDeactivate?: () => Promise<void>;
  onHealthCheck?: () => Promise<{ healthy: boolean; message?: string }>;
}

/** 测试用例 */
export interface ToolTestCase {
  name: string;
  tool: string;
  params: Record<string, unknown>;
  expect: {
    success: boolean;
    resultContains?: string;
    resultMatch?: RegExp;
  };
}

/** 测试报告 */
export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  results: Array<{
    name: string;
    tool: string;
    passed: boolean;
    error?: string;
    durationMs: number;
  }>;
}

// ==================== Plugin SDK 核心 ====================

export class PluginSDK {
  /**
   * 创建一个 Skill 插件
   * SDK 用户调用此方法定义插件
   */
  static createPlugin(def: PluginDefinition): SkillFactory {
    // 验证定义
    PluginSDK.validate(def);

    return defineSkill({
      meta: {
        name: def.name,
        version: def.version,
        description: def.description,
        author: def.author,
        category: def.category || "workflow",
        tags: def.tags || [],
        triggers: def.triggers || [],
        tools: def.tools.map((t) => t.name),
        permissions: def.permissions || [],
        requires: def.configKeys ? { config: def.configKeys } : undefined,
        enabled: true,
      },
      setup(config: AgentConfig): Tool[] {
        const context: ToolContext = {
          config,
          log: (msg) => console.log(`[${def.name}] ${msg}`),
        };

        return def.tools.map((toolDef) => ({
          name: toolDef.name,
          description: toolDef.description,
          category: (toolDef.category || "workflow") as Tool["category"],
          parameters: Object.fromEntries(
            Object.entries(toolDef.params).map(([key, schema]) => [
              key,
              {
                type: schema.type,
                description: schema.description,
                required: schema.required ?? false,
              },
            ])
          ),
          execute: async (params: Record<string, unknown>) => {
            // 参数验证
            const validationError = PluginSDK.validateParams(toolDef, params);
            if (validationError) {
              return { success: false, error: validationError };
            }

            // 填充默认值
            const finalParams = { ...params };
            for (const [key, schema] of Object.entries(toolDef.params)) {
              if (finalParams[key] === undefined && schema.default !== undefined) {
                finalParams[key] = schema.default;
              }
            }

            return toolDef.handler(finalParams, context);
          },
        }));
      },
      onActivate: def.onActivate,
      onDeactivate: def.onDeactivate,
      onHealthCheck: def.onHealthCheck,
    });
  }

  /**
   * 运行测试用例
   */
  static async runTests(
    plugin: SkillFactory,
    testCases: ToolTestCase[],
    config?: AgentConfig
  ): Promise<TestReport> {
    const skill: Skill = plugin(config || {});
    await skill.activate(config || {});

    const results: TestReport["results"] = [];

    for (const tc of testCases) {
      const start = Date.now();
      const tool = skill.tools.find((t) => t.name === tc.tool);

      if (!tool) {
        results.push({
          name: tc.name,
          tool: tc.tool,
          passed: false,
          error: `工具 ${tc.tool} 未找到`,
          durationMs: Date.now() - start,
        });
        continue;
      }

      try {
        const result = await tool.execute(tc.params);
        let passed = result.success === tc.expect.success;

        if (tc.expect.resultContains && result.data) {
          passed = passed && JSON.stringify(result.data).includes(tc.expect.resultContains);
        }

        if (tc.expect.resultMatch && result.data) {
          passed = passed && tc.expect.resultMatch.test(JSON.stringify(result.data));
        }

        results.push({
          name: tc.name,
          tool: tc.tool,
          passed,
          error: passed ? undefined : `期望 success=${tc.expect.success}，实际 success=${result.success}`,
          durationMs: Date.now() - start,
        });
      } catch (error) {
        results.push({
          name: tc.name,
          tool: tc.tool,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
      }
    }

    if (skill.deactivate) await skill.deactivate();

    return {
      total: testCases.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      results,
    };
  }

  /**
   * 生成 Skill 脚手架代码
   */
  static generateScaffold(name: string, tools: string[]): string {
    const toolDefs = tools.map(
      (t) => `    {
      name: "${t}",
      description: "${t} 描述",
      params: {
        input: { type: "string", description: "输入参数", required: true },
      },
      handler: async (params, ctx) => {
        ctx.log(\`执行 ${t}: \${params.input}\`);
        return { success: true, data: { result: "TODO" } };
      },
    }`
    );

    return `import { PluginSDK } from "@jarvis/agent-core/sdk";

/**
 * ${name} — 自定义 Skill
 */
export default PluginSDK.createPlugin({
  name: "${name}",
  version: "1.0.0",
  description: "${name} 插件描述",
  author: "your-name",
  category: "workflow",
  tags: ["${name}"],
  triggers: ["${name}"],

  tools: [
${toolDefs.join(",\n")}
  ],

  async onActivate(config) {
    console.log("${name} 已激活");
  },

  async onHealthCheck() {
    return { healthy: true, message: "一切正常" };
  },
});
`;
  }

  /**
   * 生成 package.json 模板
   */
  static generatePackageJson(name: string): string {
    return JSON.stringify(
      {
        name: `@jarvis-skills/${name}`,
        version: "1.0.0",
        description: `Jarvis Agent Skill: ${name}`,
        main: "dist/index.js",
        types: "dist/index.d.ts",
        scripts: {
          build: "tsc",
          test: "tsx test.ts",
        },
        peerDependencies: {
          "@jarvis/agent-core": ">=4.0.0",
        },
        keywords: ["jarvis", "skill", "agent", name],
        license: "MIT",
      },
      null,
      2
    );
  }

  // ==================== 内部验证 ====================

  /** 验证插件定义 */
  private static validate(def: PluginDefinition): void {
    if (!def.name || def.name.length < 2) {
      throw new Error("Plugin SDK: name 不能为空且至少 2 个字符");
    }
    if (!def.version) {
      throw new Error("Plugin SDK: version 不能为空");
    }
    if (!def.tools || def.tools.length === 0) {
      throw new Error("Plugin SDK: tools 不能为空，至少定义一个工具");
    }
    for (const tool of def.tools) {
      if (!tool.name) throw new Error(`Plugin SDK: 工具名称不能为空`);
      if (!tool.handler) throw new Error(`Plugin SDK: 工具 ${tool.name} 缺少 handler`);
    }
  }

  /** 验证工具参数 */
  private static validateParams(
    toolDef: ToolDefinition,
    params: Record<string, unknown>
  ): string | null {
    for (const [key, schema] of Object.entries(toolDef.params)) {
      if (schema.required && params[key] === undefined) {
        return `参数 ${key} 为必填`;
      }

      if (params[key] !== undefined) {
        // 类型检查
        const value = params[key];
        switch (schema.type) {
          case "string":
            if (typeof value !== "string") return `参数 ${key} 应为字符串`;
            break;
          case "number":
            if (typeof value !== "number") return `参数 ${key} 应为数字`;
            break;
          case "boolean":
            if (typeof value !== "boolean") return `参数 ${key} 应为布尔值`;
            break;
          case "array":
            if (!Array.isArray(value)) return `参数 ${key} 应为数组`;
            break;
        }

        // 枚举检查
        if (schema.enum && !schema.enum.includes(value)) {
          return `参数 ${key} 值必须为: ${schema.enum.join(", ")}`;
        }
      }
    }

    return null;
  }
}
