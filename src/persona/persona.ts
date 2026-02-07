/**
 * Persona — AI 分身人格系统
 *
 * 参考 OpenClaw 的 Persona onboarding 设计：
 * - 可配置的人格属性（名字、语气、专长）
 * - 与 Memory 整合（记住用户偏好后调整行为）
 * - 影响 LLM System Prompt（每次调用注入人格）
 * - 支持多人格切换
 */

import type { UserProfile } from "../skills/types.js";

// ==================== 类型 ====================

export interface PersonaConfig {
  /** 分身名称 */
  name: string;
  /** 一句话角色描述 */
  role: string;
  /** 详细系统提示词 */
  systemPrompt: string;
  /** 语气风格 */
  tone: "professional" | "casual" | "humorous" | "warm" | "concise";
  /** 专长领域 */
  expertise: string[];
  /** 是否主动打招呼 */
  proactive: boolean;
  /** 回复语言 */
  language: "zh-CN" | "en" | "auto";
}

// ==================== 预设人格 ====================

export const PERSONA_PRESETS: Record<string, PersonaConfig> = {
  jarvis: {
    name: "Jarvis",
    role: "全能 AI 分身助手，擅长内容运营和多平台管理",
    systemPrompt: `你是 Jarvis，一个专业的 AI 内容运营分身。
你的核心能力：
- 追踪热点话题，把握内容风口
- 为小红书、公众号等平台量身生成优质内容
- 高效管理多平台发布流程
- 数据分析，优化内容策略

你的行为准则：
- 简洁高效，不说废话
- 给出具体可执行的建议
- 遇到不确定的情况主动询问
- 保持专业但友好的语气`,
    tone: "professional",
    expertise: ["内容运营", "AI 工具", "自媒体", "小红书", "公众号"],
    proactive: true,
    language: "zh-CN",
  },

  creative: {
    name: "小创",
    role: "创意内容专家，脑洞大开，灵感不断",
    systemPrompt: `你是小创，一个充满创意的内容助手。
你擅长：
- 想出吸引眼球的标题和选题
- 把无聊的话题变得有趣
- 追热点但不跟风，有自己的角度
- 各种文案风格切换自如

你的特点：
- 说话活泼有趣
- 善用比喻和故事
- 经常给出多个创意方案
- 偶尔来点冷幽默`,
    tone: "humorous",
    expertise: ["创意写作", "文案", "选题策划", "标题党"],
    proactive: true,
    language: "zh-CN",
  },

  analyst: {
    name: "数据官",
    role: "数据驱动的运营分析师",
    systemPrompt: `你是数据官，一个严谨的运营数据分析师。
你擅长：
- 分析内容数据（阅读量、互动率、转化率）
- 发现内容趋势和规律
- 基于数据给出优化建议
- 竞品分析和市场洞察

你的特点：
- 用数据说话
- 逻辑清晰
- 给出量化的建议
- 客观理性`,
    tone: "concise",
    expertise: ["数据分析", "运营策略", "竞品分析", "增长"],
    proactive: false,
    language: "zh-CN",
  },
};

// ==================== Persona Manager ====================

export class PersonaManager {
  private current: PersonaConfig;
  private customs: Map<string, PersonaConfig> = new Map();

  constructor(initialPersona?: string | PersonaConfig) {
    if (typeof initialPersona === "string") {
      this.current = PERSONA_PRESETS[initialPersona] || PERSONA_PRESETS.jarvis;
    } else if (initialPersona) {
      this.current = initialPersona;
    } else {
      this.current = PERSONA_PRESETS.jarvis;
    }
  }

  /** 获取当前人格 */
  getCurrent(): PersonaConfig {
    return { ...this.current };
  }

  /** 切换到预设人格 */
  switchTo(name: string): boolean {
    const preset = PERSONA_PRESETS[name] || this.customs.get(name);
    if (!preset) return false;
    this.current = preset;
    console.log(`[Persona] 已切换到: ${this.current.name}`);
    return true;
  }

  /** 注册自定义人格 */
  register(persona: PersonaConfig): void {
    this.customs.set(persona.name.toLowerCase(), persona);
  }

  /** 列出所有可用人格 */
  listAll(): Array<{ name: string; role: string; active: boolean }> {
    const all = new Map<string, PersonaConfig>();

    for (const [key, preset] of Object.entries(PERSONA_PRESETS)) {
      all.set(key, preset);
    }
    for (const [key, custom] of this.customs) {
      all.set(key, custom);
    }

    return Array.from(all.entries()).map(([key, p]) => ({
      name: p.name,
      role: p.role,
      active: p.name === this.current.name,
    }));
  }

  /**
   * 构建完整的 System Prompt
   * 整合人格 + 用户画像 + 技能描述
   */
  buildSystemPrompt(
    userProfile?: UserProfile,
    skillsPrompt?: string
  ): string {
    const parts: string[] = [];

    // 人格基础 prompt
    parts.push(this.current.systemPrompt);

    // 注入用户画像
    if (userProfile) {
      const profileParts: string[] = [];
      if (userProfile.nickname) profileParts.push(`用户昵称: ${userProfile.nickname}`);
      if (userProfile.preferredTopics?.length)
        profileParts.push(`用户偏好领域: ${userProfile.preferredTopics.join(", ")}`);
      if (userProfile.preferredStyle)
        profileParts.push(`用户偏好风格: ${userProfile.preferredStyle}`);
      if (userProfile.platforms?.length)
        profileParts.push(`用户常用平台: ${userProfile.platforms.join(", ")}`);

      if (profileParts.length) {
        parts.push(`\n## 用户信息\n${profileParts.join("\n")}`);
      }
    }

    // 注入技能描述
    if (skillsPrompt) {
      parts.push(`\n${skillsPrompt}`);
    }

    return parts.join("\n\n");
  }
}
