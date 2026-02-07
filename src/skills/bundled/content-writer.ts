/**
 * Skill: content-writer — AI 内容生成引擎
 *
 * 工具：
 * - ai-generate-content: AI 生成图文（支持小红书/公众号/通用风格）
 * - ai-generate-image: AI 文生图（Gemini Imagen 4）
 * - ai-summarize: AI 长文摘要
 *
 * 依赖：DeepSeek / Gemini / OpenAI API
 */

import { wrapToolsAsSkill } from "../define.js";
import { createAiTools } from "../../tools/ai.js";

export const contentWriterSkill = wrapToolsAsSkill(
  {
    name: "content-writer",
    version: "1.0.0",
    description: "AI 内容创作引擎 — 生成小红书/公众号/通用图文、AI 配图、长文摘要",
    author: "jarvis",
    category: "content",
    tags: ["ai", "generation", "writing", "image", "summarize"],
    triggers: ["生成", "写", "创作", "配图", "摘要", "总结"],
    tools: ["ai-generate-content", "ai-generate-image", "ai-summarize"],
    permissions: ["network", "llm"],
    enabled: true,
  },
  createAiTools
);

export default contentWriterSkill;
