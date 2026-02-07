/**
 * Skill 定义辅助工具
 *
 * 提供 defineSkill() 函数，简化 Skill 创建过程。
 * 用法：
 *
 * ```ts
 * export default defineSkill({
 *   meta: { name: "my-skill", version: "1.0.0", ... },
 *   setup(config) {
 *     return [tool1, tool2];
 *   }
 * });
 * ```
 */

import type { Tool, AgentConfig } from "../types.js";
import type { Skill, SkillMeta, SkillFactory } from "./types.js";

/** Skill 定义选项 */
export interface SkillDefinition {
  /** Skill 元数据 */
  meta: SkillMeta;

  /**
   * 工具创建函数
   * 接收配置，返回工具列表
   */
  setup(config: AgentConfig): Tool[];

  /**
   * 激活时的初始化逻辑（可选）
   */
  onActivate?(config: AgentConfig): Promise<void>;

  /**
   * 停用时的清理逻辑（可选）
   */
  onDeactivate?(): Promise<void>;

  /**
   * 健康检查（可选）
   */
  onHealthCheck?(): Promise<{ healthy: boolean; message?: string }>;
}

/**
 * 定义一个 Skill
 *
 * 返回 SkillFactory，可被 SkillRuntime 加载
 */
export function defineSkill(def: SkillDefinition): SkillFactory {
  return (config: AgentConfig): Skill => {
    let tools: Tool[] = [];

    return {
      get meta() {
        return def.meta;
      },

      get tools() {
        return tools;
      },

      async activate(cfg: AgentConfig) {
        tools = def.setup(cfg);
        if (def.onActivate) {
          await def.onActivate(cfg);
        }
      },

      async deactivate() {
        if (def.onDeactivate) {
          await def.onDeactivate();
        }
        tools = [];
      },

      healthCheck: def.onHealthCheck
        ? async () => def.onHealthCheck!()
        : undefined,
    };
  };
}

/**
 * 从现有 Tool 创建函数快速包装为 Skill
 *
 * 将旧的 createXxxTools(config) 模式迁移为 Skill
 */
export function wrapToolsAsSkill(
  meta: SkillMeta,
  toolFactory: (config: AgentConfig) => Tool[]
): SkillFactory {
  return defineSkill({
    meta,
    setup: toolFactory,
  });
}
