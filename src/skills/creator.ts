/**
 * SkillCreator — AI 自创建 Skill
 *
 * 参考 OpenClaw 的核心特性：Agent 运行时自己编写新 Skill
 *
 * 工作流：
 * 1. 用户描述需要的功能（如 "帮我做个查天气的功能"）
 * 2. LLM 分析需求，生成 Skill 代码（TypeScript）
 * 3. 写入文件系统（~/.jarvis/skills/<name>/）
 * 4. 动态加载并激活
 *
 * 安全措施：
 * - 生成的代码经过基本安全检查
 * - Skill 在沙箱环境中执行（未来）
 * - 需要用户确认才能激活
 */

import type { AgentConfig } from "../types.js";
import type { SkillSpec, SkillMeta } from "./types.js";
import { LLMClient, createLLMClient } from "../providers/llm.js";

// ==================== Prompt 模板 ====================

const SKILL_CREATION_PROMPT = `你是一个 TypeScript 开发专家。请根据用户需求生成一个 Jarvis Agent Skill。

## Skill 规范

每个 Skill 需要两个文件：

### 1. skill.json（元数据）
\`\`\`json
{
  "name": "skill-name",
  "version": "1.0.0",
  "description": "一句话描述",
  "author": "jarvis-ai",
  "category": "system",
  "tags": ["tag1", "tag2"],
  "triggers": ["触发词1", "触发词2"],
  "permissions": ["network"],
  "enabled": true
}
\`\`\`

### 2. index.ts（实现）
\`\`\`typescript
import { defineSkill } from "@jarvis/agent-core";

export default defineSkill({
  meta: { /* 和 skill.json 一致 */ },
  setup(config) {
    return [
      {
        name: "tool-name",
        description: "工具描述",
        category: "workflow",
        parameters: {
          param1: { type: "string", description: "参数描述", required: true },
        },
        execute: async (params) => {
          // 实现逻辑
          return { success: true, data: { /* 结果 */ } };
        },
      },
    ];
  },
});
\`\`\`

## 要求
1. 代码必须是有效的 TypeScript
2. 使用 fetch 进行 HTTP 请求（不要引入额外依赖）
3. 所有工具必须返回 { success: boolean, data?: any, error?: string }
4. 代码要简洁实用
5. category 必须是: content | publish | infrastructure | communication | memory | workflow | system

## 输出格式
严格按 JSON 输出：
{
  "skillMeta": { /* skill.json 内容 */ },
  "code": "// index.ts 完整代码（不含 \`\`\` 包裹）",
  "explanation": "简短说明这个 Skill 做什么"
}`;

// ==================== SkillCreator ====================

export interface CreatedSkill {
  meta: SkillMeta;
  code: string;
  explanation: string;
  savedPath?: string;
}

export class SkillCreator {
  private llm: LLMClient | null;

  constructor(config: AgentConfig) {
    this.llm = createLLMClient(config);
  }

  /**
   * 根据自然语言描述生成 Skill
   *
   * @param description 用户描述（如 "做一个查天气的功能"）
   * @returns 生成的 Skill 代码和元数据
   */
  async createSkill(description: string): Promise<CreatedSkill> {
    if (!this.llm) {
      throw new Error("Skill 自创建需要配置 LLM API Key");
    }

    const result = await this.llm.completeJSON<{
      skillMeta: SkillMeta;
      code: string;
      explanation: string;
    }>(
      `${SKILL_CREATION_PROMPT}\n\n用户需求：${description}`,
      { temperature: 0.5, maxTokens: 4000 }
    );

    // 基本安全检查
    this.validateCode(result.code);

    return {
      meta: result.skillMeta,
      code: result.code,
      explanation: result.explanation,
    };
  }

  /**
   * 生成并保存 Skill 到文件系统
   *
   * @param description 用户描述
   * @param baseDir 保存目录（默认 ~/.jarvis/skills/）
   * @returns 保存后的 Skill 信息
   */
  async createAndSave(
    description: string,
    baseDir?: string
  ): Promise<CreatedSkill> {
    const skill = await this.createSkill(description);

    const fs = await import("fs");
    const path = await import("path");

    const home = process.env.HOME || process.env.USERPROFILE || ".";
    const dir = baseDir || path.join(home, ".jarvis", "skills");
    const skillDir = path.join(dir, skill.meta.name);

    // 创建目录
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    // 写入 skill.json
    fs.writeFileSync(
      path.join(skillDir, "skill.json"),
      JSON.stringify(skill.meta, null, 2),
      "utf-8"
    );

    // 写入 index.ts
    fs.writeFileSync(
      path.join(skillDir, "index.ts"),
      skill.code,
      "utf-8"
    );

    skill.savedPath = skillDir;
    console.log(`[SkillCreator] Skill "${skill.meta.name}" 已保存到 ${skillDir}`);

    return skill;
  }

  /**
   * 从 SkillSpec 生成代码（结构化输入）
   */
  async createFromSpec(spec: SkillSpec): Promise<CreatedSkill> {
    const description = `
Skill 名称: ${spec.name}
描述: ${spec.description}
需要实现的工具:
${spec.tools.map((t) => `- ${t.name}: ${t.description}\n  参数: ${JSON.stringify(t.parameters)}`).join("\n")}
${spec.instructions ? `\n额外说明: ${spec.instructions}` : ""}`;

    return this.createSkill(description);
  }

  // ==================== 安全检查 ====================

  private validateCode(code: string): void {
    const dangerous = [
      "child_process",
      "eval(",
      "Function(",
      "require(",
      "process.exit",
      "fs.rmSync",
      "fs.rmdirSync",
      "rimraf",
      "execSync",
      "spawnSync",
    ];

    for (const pattern of dangerous) {
      if (code.includes(pattern)) {
        throw new Error(
          `安全检查失败: 生成的代码包含危险操作 "${pattern}"。\n` +
          `如果确实需要此功能，请手动创建 Skill。`
        );
      }
    }

    // 检查基本结构
    if (!code.includes("defineSkill") && !code.includes("export")) {
      throw new Error("生成的代码缺少必要的 defineSkill 导出。");
    }
  }
}
