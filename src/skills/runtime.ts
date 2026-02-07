/**
 * SkillRuntime — 技能运行时引擎
 *
 * 参考 OpenClaw 的多目录加载机制 + 优先级覆盖：
 * - bundled: 内置 Skill（代码中注册）
 * - managed: ~/.jarvis/skills/ 下安装的 Skill
 * - workspace: 项目目录 skills/ 下的 Skill
 * - runtime: Agent 运行时动态创建的 Skill
 *
 * 加载优先级：workspace > managed > bundled（同名覆盖）
 */

import type { AgentConfig, Tool } from "../types.js";
import type {
  Skill,
  SkillMeta,
  SkillFactory,
  SkillSource,
  LoadedSkill,
  SkillSearchResult,
  SkillCategory,
} from "./types.js";

// ==================== SkillRuntime ====================

export class SkillRuntime {
  /** 已加载的 Skill 映射 */
  private skills: Map<string, LoadedSkill> = new Map();
  /** 全局配置 */
  private config: AgentConfig;
  /** 事件回调 */
  private listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  constructor(config: AgentConfig = {}) {
    this.config = config;
  }

  // ==================== 注册 & 加载 ====================

  /**
   * 注册内置 Skill（bundled）
   * 通过工厂函数创建，最低优先级
   */
  registerBundled(factory: SkillFactory): void {
    const skill = factory(this.config);
    this.loadSkillInstance(skill, "bundled");
  }

  /**
   * 批量注册内置 Skill
   */
  registerBundledAll(factories: SkillFactory[]): void {
    for (const factory of factories) {
      this.registerBundled(factory);
    }
  }

  /**
   * 从文件系统目录加载 Skill
   * 目录结构：skills/<name>/skill.json + index.ts
   *
   * 注意：此方法需要在 Node.js 环境中运行
   * 使用动态 import 加载 Skill 模块
   */
  async loadFromDirectory(dir: string, source: SkillSource = "workspace"): Promise<string[]> {
    const loaded: string[] = [];

    try {
      const fs = await import("fs");
      const path = await import("path");

      if (!fs.existsSync(dir)) {
        console.log(`[SkillRuntime] 目录不存在，跳过: ${dir}`);
        return loaded;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) {
          continue;
        }

        const skillDir = path.join(dir, entry.name);
        const metaPath = path.join(skillDir, "skill.json");

        if (!fs.existsSync(metaPath)) {
          console.warn(`[SkillRuntime] 跳过 ${entry.name}: 缺少 skill.json`);
          continue;
        }

        try {
          // 读取元数据
          const metaRaw = fs.readFileSync(metaPath, "utf-8");
          const meta: SkillMeta = JSON.parse(metaRaw);

          // 检查是否启用
          if (meta.enabled === false) {
            console.log(`[SkillRuntime] 跳过 ${meta.name}: 已禁用`);
            continue;
          }

          // 检查依赖要求
          if (!this.checkRequirements(meta)) {
            console.warn(`[SkillRuntime] 跳过 ${meta.name}: 依赖不满足`);
            continue;
          }

          // 动态加载模块
          const indexPath = path.join(skillDir, "index.ts");
          const indexJsPath = path.join(skillDir, "index.js");
          const modulePath = fs.existsSync(indexJsPath) ? indexJsPath : indexPath;

          if (!fs.existsSync(modulePath)) {
            console.warn(`[SkillRuntime] 跳过 ${meta.name}: 缺少 index.ts/index.js`);
            continue;
          }

          const module = await import(modulePath);
          const factory: SkillFactory = module.default || module.createSkill;

          if (typeof factory !== "function") {
            console.warn(`[SkillRuntime] 跳过 ${meta.name}: 未导出 default 或 createSkill`);
            continue;
          }

          const skill = factory(this.config);
          this.loadSkillInstance(skill, source, skillDir);
          loaded.push(meta.name);
        } catch (error) {
          console.error(`[SkillRuntime] 加载 ${entry.name} 失败:`, error);
        }
      }
    } catch (error) {
      console.error(`[SkillRuntime] 扫描目录失败: ${dir}`, error);
    }

    return loaded;
  }

  /**
   * 加载一个 Skill 实例
   * 处理同名覆盖（高优先级覆盖低优先级）
   */
  private loadSkillInstance(skill: Skill, source: SkillSource, path?: string): void {
    const name = skill.meta.name;
    const existing = this.skills.get(name);

    // 优先级：workspace(3) > managed(2) > runtime(1.5) > bundled(1)
    const priorityMap: Record<SkillSource, number> = {
      bundled: 1,
      runtime: 1.5,
      managed: 2,
      workspace: 3,
    };

    if (existing) {
      const existingPriority = skill.meta.priority ?? priorityMap[existing.source];
      const newPriority = skill.meta.priority ?? priorityMap[source];

      if (newPriority <= existingPriority) {
        console.log(`[SkillRuntime] ${name}: 已有更高优先级版本（${existing.source}），跳过 ${source}`);
        return;
      }

      // 停用旧版本
      if (existing.active) {
        existing.skill.deactivate().catch((e) =>
          console.error(`[SkillRuntime] 停用旧 ${name} 失败:`, e)
        );
      }
    }

    this.skills.set(name, {
      skill,
      source,
      path,
      loadedAt: new Date(),
      active: false,
    });

    console.log(`[SkillRuntime] 已加载: ${name} (${source}) — ${skill.tools.length} 个工具`);
    this.emit("skill:loaded", name, source);
  }

  // ==================== 激活 & 停用 ====================

  /** 激活所有已加载的 Skill */
  async activateAll(): Promise<void> {
    const tasks = Array.from(this.skills.entries()).map(async ([name, entry]) => {
      if (entry.active) return;
      try {
        await entry.skill.activate(this.config);
        entry.active = true;
        console.log(`[SkillRuntime] 已激活: ${name}`);
        this.emit("skill:activated", name);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        console.error(`[SkillRuntime] 激活 ${name} 失败:`, error);
        this.emit("skill:error", name, entry.error);
      }
    });

    await Promise.all(tasks);
  }

  /** 激活单个 Skill */
  async activateSkill(name: string): Promise<boolean> {
    const entry = this.skills.get(name);
    if (!entry) return false;
    if (entry.active) return true;

    try {
      await entry.skill.activate(this.config);
      entry.active = true;
      this.emit("skill:activated", name);
      return true;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** 停用 Skill */
  async deactivateSkill(name: string): Promise<boolean> {
    const entry = this.skills.get(name);
    if (!entry || !entry.active) return false;

    try {
      await entry.skill.deactivate();
      entry.active = false;
      this.emit("skill:deactivated", name);
      return true;
    } catch (error) {
      console.error(`[SkillRuntime] 停用 ${name} 失败:`, error);
      return false;
    }
  }

  /** 卸载 Skill */
  async unloadSkill(name: string): Promise<boolean> {
    const entry = this.skills.get(name);
    if (!entry) return false;

    if (entry.active) {
      await this.deactivateSkill(name);
    }
    this.skills.delete(name);
    this.emit("skill:unloaded", name);
    return true;
  }

  // ==================== 查询 ====================

  /** 获取所有已激活的 Tools（聚合所有 Skill 的 Tools） */
  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const entry of this.skills.values()) {
      if (entry.active) {
        tools.push(...entry.skill.tools);
      }
    }
    return tools;
  }

  /** 获取单个 Tool */
  getTool(toolName: string): Tool | undefined {
    for (const entry of this.skills.values()) {
      if (!entry.active) continue;
      const tool = entry.skill.tools.find((t) => t.name === toolName);
      if (tool) return tool;
    }
    return undefined;
  }

  /** 查找 Tool 所属的 Skill */
  findSkillByTool(toolName: string): LoadedSkill | undefined {
    for (const entry of this.skills.values()) {
      if (entry.skill.tools.some((t) => t.name === toolName)) {
        return entry;
      }
    }
    return undefined;
  }

  /** 按分类获取 Skill */
  getSkillsByCategory(category: SkillCategory): LoadedSkill[] {
    return Array.from(this.skills.values()).filter(
      (e) => e.skill.meta.category === category
    );
  }

  /** 搜索 Skill */
  searchSkills(query: string): SkillSearchResult[] {
    const q = query.toLowerCase();
    return Array.from(this.skills.values())
      .filter((entry) => {
        const meta = entry.skill.meta;
        return (
          meta.name.toLowerCase().includes(q) ||
          meta.description.toLowerCase().includes(q) ||
          meta.tags?.some((t) => t.toLowerCase().includes(q)) ||
          meta.triggers?.some((t) => t.toLowerCase().includes(q))
        );
      })
      .map((entry) => ({
        name: entry.skill.meta.name,
        description: entry.skill.meta.description,
        category: entry.skill.meta.category,
        tags: entry.skill.meta.tags || [],
        source: entry.source,
        active: entry.active,
        toolCount: entry.skill.tools.length,
        tools: entry.skill.tools.map((t) => t.name),
      }));
  }

  /** 获取所有 Skill 状态 */
  getStatus(): SkillSearchResult[] {
    return Array.from(this.skills.values()).map((entry) => ({
      name: entry.skill.meta.name,
      description: entry.skill.meta.description,
      category: entry.skill.meta.category,
      tags: entry.skill.meta.tags || [],
      source: entry.source,
      active: entry.active,
      toolCount: entry.skill.tools.length,
      tools: entry.skill.tools.map((t) => t.name),
    }));
  }

  /** 获取 Skill 元数据（供 LLM System Prompt 使用） */
  getSkillsPrompt(): string {
    const lines: string[] = ["## 可用技能\n"];

    for (const entry of this.skills.values()) {
      if (!entry.active) continue;
      const meta = entry.skill.meta;
      lines.push(`### ${meta.name}`);
      lines.push(`${meta.description}`);
      if (meta.triggers?.length) {
        lines.push(`触发词: ${meta.triggers.join(", ")}`);
      }
      lines.push(`工具: ${entry.skill.tools.map((t) => `${t.name}(${t.description})`).join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /** 根据触发词匹配 Skill */
  matchByTrigger(instruction: string): LoadedSkill[] {
    const lower = instruction.toLowerCase();
    const matched: Array<{ entry: LoadedSkill; score: number }> = [];

    for (const entry of this.skills.values()) {
      if (!entry.active) continue;
      const triggers = entry.skill.meta.triggers || [];
      let score = 0;

      for (const trigger of triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          score += 1;
        }
      }

      if (score > 0) {
        matched.push({ entry, score });
      }
    }

    return matched
      .sort((a, b) => b.score - a.score)
      .map((m) => m.entry);
  }

  // ==================== 健康检查 ====================

  /** 对所有活跃 Skill 执行健康检查 */
  async healthCheckAll(): Promise<Record<string, { healthy: boolean; message?: string }>> {
    const results: Record<string, { healthy: boolean; message?: string }> = {};

    for (const [name, entry] of this.skills.entries()) {
      if (!entry.active) {
        results[name] = { healthy: false, message: "未激活" };
        continue;
      }

      if (entry.skill.healthCheck) {
        try {
          results[name] = await entry.skill.healthCheck();
        } catch (error) {
          results[name] = {
            healthy: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      } else {
        results[name] = { healthy: true, message: "无健康检查" };
      }
    }

    return results;
  }

  // ==================== 依赖检查 ====================

  /** 检查 Skill 的运行时需求 */
  private checkRequirements(meta: SkillMeta): boolean {
    const req = meta.requires;
    if (!req) return true;

    // 检查操作系统
    if (req.os && !req.os.includes(process.platform as "darwin" | "linux" | "win32")) {
      return false;
    }

    // 检查环境变量
    if (req.env) {
      for (const envVar of req.env) {
        if (!process.env[envVar]) {
          console.warn(`[SkillRuntime] ${meta.name}: 缺少环境变量 ${envVar}`);
          return false;
        }
      }
    }

    // 检查配置项
    if (req.config) {
      for (const configKey of req.config) {
        const parts = configKey.split(".");
        let obj: unknown = this.config;
        for (const part of parts) {
          obj = (obj as Record<string, unknown>)?.[part];
        }
        if (obj === undefined || obj === null || obj === "") {
          console.warn(`[SkillRuntime] ${meta.name}: 缺少配置 ${configKey}`);
          return false;
        }
      }
    }

    return true;
  }

  // ==================== 事件系统（简易） ====================

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  private emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(...args);
        } catch (e) {
          console.error(`[SkillRuntime] 事件回调异常 (${event}):`, e);
        }
      }
    }
  }

  // ==================== 统计 ====================

  get skillCount(): number {
    return this.skills.size;
  }

  get activeSkillCount(): number {
    let count = 0;
    for (const entry of this.skills.values()) {
      if (entry.active) count++;
    }
    return count;
  }

  get totalToolCount(): number {
    let count = 0;
    for (const entry of this.skills.values()) {
      if (entry.active) count += entry.skill.tools.length;
    }
    return count;
  }
}
