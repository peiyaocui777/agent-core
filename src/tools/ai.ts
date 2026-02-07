/**
 * AI 内容生成工具 — 接入真实 LLM API
 *
 * 支持 DeepSeek / Gemini / OpenAI 等 OpenAI 兼容 API。
 * 未配置 API Key 时自动降级为 fallback 模式。
 */

import type { Tool, AgentConfig } from "../types.js";
import { createLLMClient, type LLMClient } from "../providers/llm.js";

// ==================== Prompt 模板 ====================

const PROMPTS = {
  xhsContent: (topic: string, style: string) => `你是一个专业的小红书内容创作者。请根据以下主题生成一篇小红书风格的图文内容。

主题：${topic}
风格：${style}

要求：
1. 标题要有吸引力，使用 emoji，不超过 20 个汉字
2. 正文 300-500 字，分段清晰，使用 emoji 增加可读性
3. 生成 5-8 个相关标签
4. 推荐 3 个配图描述（用于 AI 生图）

请严格按以下 JSON 格式输出：
{
  "title": "标题",
  "content": "正文内容",
  "tags": ["标签1", "标签2", ...],
  "imagePrompts": ["配图描述1", "配图描述2", "配图描述3"]
}`,

  wechatContent: (topic: string, style: string) => `你是一个专业的微信公众号编辑。请根据以下主题生成一篇公众号文章。

主题：${topic}
风格：${style}

要求：
1. 标题简洁有力，有信息增量
2. 正文 800-1500 字，使用 Markdown 格式
3. 包含引言、正文、总结三部分
4. 生成 3-5 个关键词

请严格按以下 JSON 格式输出：
{
  "title": "标题",
  "content": "Markdown 正文",
  "tags": ["关键词1", "关键词2", ...],
  "summary": "100字以内摘要"
}`,

  generalContent: (topic: string) => `请根据以下主题生成一篇高质量的内容。

主题：${topic}

要求：
1. 标题吸引人
2. 正文 500-1000 字
3. 生成相关标签

请严格按以下 JSON 格式输出：
{
  "title": "标题",
  "content": "正文",
  "tags": ["标签1", "标签2", ...],
  "summary": "摘要"
}`,

  summarize: (content: string, maxLength: number) => `请对以下内容进行精炼摘要，不超过 ${maxLength} 字。保留核心观点。

原文：
${content}

请严格按以下 JSON 格式输出：
{
  "summary": "摘要内容",
  "keyPoints": ["要点1", "要点2", ...],
  "keywords": ["关键词1", "关键词2", ...]
}`,
};

// ==================== 工具实现 ====================

interface ContentResult {
  title: string;
  content: string;
  tags: string[];
  imagePrompts?: string[];
  summary?: string;
}

interface SummaryResult {
  summary: string;
  keyPoints: string[];
  keywords: string[];
}

export function createAiTools(config: AgentConfig): Tool[] {
  let llm: LLMClient | null = null;

  // 懒加载 LLM 客户端
  function getLLM(): LLMClient | null {
    if (!llm && config.llm?.apiKey) {
      llm = createLLMClient(config);
    }
    return llm;
  }

  return [
    {
      name: "ai-generate-content",
      description: "AI 生成图文内容（标题 + 正文 + 标签），支持小红书/公众号/通用风格",
      category: "generate",
      parameters: {
        topic: { type: "string", description: "主题或关键词", required: true },
        platform: { type: "string", description: "目标平台: xhs / wechat / general", required: false },
        style: { type: "string", description: "风格: 专业 / 轻松 / 种草 / 深度", required: false },
      },
      execute: async (params) => {
        const topic = String(params.topic);
        const platform = (params.platform as string) || "general";
        const style = (params.style as string) || "轻松";
        const client = getLLM();

        if (!client) {
          // Fallback: 未配置 LLM
          return {
            success: true,
            data: {
              title: `${topic}`,
              content: `关于「${topic}」的内容。（LLM 未配置，请设置 config.llm.apiKey）`,
              tags: [topic, "AI生成"],
              platform,
              _fallback: true,
            },
          };
        }

        try {
          let prompt: string;
          if (platform === "xhs") {
            prompt = PROMPTS.xhsContent(topic, style);
          } else if (platform === "wechat") {
            prompt = PROMPTS.wechatContent(topic, style);
          } else {
            prompt = PROMPTS.generalContent(topic);
          }

          const result = await client.completeJSON<ContentResult>(prompt, {
            temperature: 0.8,
            maxTokens: 3000,
          });

          return {
            success: true,
            data: {
              ...result,
              platform,
              _llmProvider: client.getInfo().provider,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `AI 生成失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },

    {
      name: "ai-generate-image",
      description: "AI 文生图（Gemini Imagen 4 API）",
      category: "generate",
      parameters: {
        prompt: { type: "string", description: "图片描述（中英文均可）", required: true },
        aspectRatio: { type: "string", description: "比例: 1:1 / 3:4 / 16:9", required: false },
      },
      execute: async (params) => {
        const prompt = String(params.prompt);
        const aspectRatio = (params.aspectRatio as string) || "3:4";

        // Gemini Imagen 4 API 需要单独处理（非 Chat Completions 格式）
        if (!config.llm?.apiKey || config.llm.provider !== "gemini") {
          return {
            success: true,
            data: {
              imageUrl: null,
              prompt,
              aspectRatio,
              _note: "图片生成需要 Gemini API Key（provider 设为 gemini）",
              _fallback: true,
            },
          };
        }

        try {
          const apiKey = config.llm.apiKey;
          const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instances: [{ prompt }],
              parameters: {
                sampleCount: 1,
                aspectRatio,
              },
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Imagen API 错误 [${response.status}]: ${errorText}`);
          }

          const data = await response.json() as {
            predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
          };

          if (data.predictions?.[0]) {
            return {
              success: true,
              data: {
                imageBase64: data.predictions[0].bytesBase64Encoded,
                mimeType: data.predictions[0].mimeType || "image/png",
                prompt,
                aspectRatio,
              },
            };
          }

          return { success: false, error: "Imagen API 未返回图片数据" };
        } catch (error) {
          return {
            success: false,
            error: `图片生成失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },

    {
      name: "ai-summarize",
      description: "AI 摘要（输入长文 → 输出精炼摘要 + 关键词 + 要点）",
      category: "generate",
      parameters: {
        content: { type: "string", description: "原文内容", required: true },
        maxLength: { type: "number", description: "最大字数", required: false },
      },
      execute: async (params) => {
        const content = String(params.content);
        const maxLength = (params.maxLength as number) || 200;
        const client = getLLM();

        if (!client) {
          return {
            success: true,
            data: {
              summary: content.slice(0, maxLength) + "...",
              keyPoints: [],
              keywords: [],
              _fallback: true,
            },
          };
        }

        try {
          const result = await client.completeJSON<SummaryResult>(
            PROMPTS.summarize(content, maxLength),
            { temperature: 0.3, maxTokens: 1000 }
          );

          return {
            success: true,
            data: {
              ...result,
              originalLength: content.length,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `摘要生成失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },
  ];
}
