/**
 * 内容采集工具
 *
 * 封装多种数据源采集能力：
 * - 热点新闻采集（通用 web 搜索）
 * - 小红书内容搜索（通过 xiaohongshu-mcp）
 * - RSS/URL 内容提取
 * - ai-trend-publish scraper 代理
 */

import type { Tool, AgentConfig } from "../types.js";
import { createLLMClient } from "../providers/llm.js";

export function createScraperTools(config: AgentConfig): Tool[] {
  const xhsUrl = config.xhsApiUrl || "http://127.0.0.1:18060";
  const trendUrl = config.trendApiUrl || "http://127.0.0.1:3001";

  return [
    {
      name: "scrape-trending",
      description: "采集当前热点话题（通过 Jina / Web 搜索获取实时热点）",
      category: "generate",
      parameters: {
        domain: { type: "string", description: "领域: tech / finance / lifestyle / health / all", required: false },
        count: { type: "number", description: "获取条数（默认 10）", required: false },
      },
      execute: async (params) => {
        const domain = (params.domain as string) || "all";
        const count = (params.count as number) || 10;

        // 优先通过 ai-trend-publish 的 scraper 采集
        try {
          const res = await fetch(`${trendUrl}/api/scrape`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "scrape",
              params: { domain, count },
              id: Date.now().toString(),
            }),
          });

          if (res.ok) {
            const data = await res.json();
            return { success: true, data };
          }
        } catch {
          // ai-trend-publish 不可用，使用 fallback
        }

        // Fallback: 使用 LLM 生成热点推荐
        const llm = config.llm?.apiKey ? createLLMClient(config) : null;
        if (llm) {
          try {
            const result = await llm.completeJSON<{ topics: Array<{ title: string; description: string; heat: number }> }>(
              `你是一个热点分析师。请列出当前${domain === "all" ? "各领域" : domain + "领域"}最热门的${count}个话题。
每个话题包含标题、简短描述、热度评分(0-100)。
输出 JSON: { "topics": [{ "title": "", "description": "", "heat": 0 }] }`,
              { temperature: 0.9 }
            );
            return {
              success: true,
              data: { ...result, source: "llm-generated", domain },
            };
          } catch (error) {
            return {
              success: false,
              error: `热点采集失败: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }

        return {
          success: true,
          data: {
            topics: [
              { title: "AI 技术最新进展", description: "大模型和自动化", heat: 95 },
              { title: "小红书运营技巧", description: "内容创作方法论", heat: 88 },
              { title: "独立开发者变现", description: "产品和渠道策略", heat: 82 },
            ],
            source: "fallback",
            _note: "ai-trend-publish 和 LLM 均不可用，返回预设热点",
          },
        };
      },
    },

    {
      name: "scrape-xhs-notes",
      description: "搜索小红书笔记（获取竞品内容/灵感采集）",
      category: "generate",
      parameters: {
        keyword: { type: "string", description: "搜索关键词", required: true },
        count: { type: "number", description: "获取条数（默认 10）", required: false },
      },
      execute: async (params) => {
        const keyword = String(params.keyword);
        const count = (params.count as number) || 10;

        try {
          const res = await fetch(`${xhsUrl}/api/v1/feeds/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyword, count }),
          });

          if (!res.ok) {
            throw new Error(`xiaohongshu-mcp 返回 ${res.status}`);
          }

          const data = await res.json();
          return {
            success: true,
            data: {
              notes: data,
              keyword,
              count,
              source: "xiaohongshu-mcp",
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `小红书采集失败（请确认 xiaohongshu-mcp 已启动在 ${xhsUrl}）: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },

    {
      name: "scrape-url",
      description: "从 URL 提取文章内容（标题 + 正文 + 摘要）",
      category: "generate",
      parameters: {
        url: { type: "string", description: "目标网页 URL", required: true },
      },
      execute: async (params) => {
        const targetUrl = String(params.url);

        // 方式 1: 通过 Jina Reader API 提取（免费、无需部署）
        try {
          const jinaUrl = `https://r.jina.ai/${targetUrl}`;
          const res = await fetch(jinaUrl, {
            headers: { Accept: "application/json" },
          });

          if (res.ok) {
            const data = await res.json() as {
              data?: { title: string; content: string; description: string };
            };
            if (data.data) {
              return {
                success: true,
                data: {
                  title: data.data.title,
                  content: data.data.content,
                  description: data.data.description,
                  url: targetUrl,
                  source: "jina-reader",
                },
              };
            }
          }
        } catch {
          // Jina 不可用
        }

        // 方式 2: 通过 ai-trend-publish 的 scraper
        try {
          const res = await fetch(`${trendUrl}/api/scrape/url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: targetUrl }),
          });

          if (res.ok) {
            const data = await res.json();
            return {
              success: true,
              data: { ...data, source: "ai-trend-publish" },
            };
          }
        } catch {
          // ai-trend-publish 不可用
        }

        return {
          success: false,
          error: `URL 内容提取失败: Jina Reader 和 ai-trend-publish 均不可用。URL: ${targetUrl}`,
        };
      },
    },

    {
      name: "analyze-content",
      description: "分析采集到的内容并评分排序（用于筛选高质量选题）",
      category: "generate",
      parameters: {
        contents: { type: "array", description: "待分析的内容数组 [{title, content}]", required: true },
      },
      execute: async (params) => {
        const contents = params.contents as Array<{ title: string; content?: string }>;

        const llm = config.llm?.apiKey ? createLLMClient(config) : null;
        if (!llm) {
          // Fallback: 简单按标题长度排序
          return {
            success: true,
            data: {
              ranked: contents.map((c, i) => ({
                ...c,
                score: Math.max(10 - i, 1),
                reason: "未配置 LLM，使用默认排序",
              })),
              _fallback: true,
            },
          };
        }

        try {
          const contentList = contents
            .map((c, i) => `${i + 1}. ${c.title}${c.content ? ": " + c.content.slice(0, 100) : ""}`)
            .join("\n");

          const result = await llm.completeJSON<{
            ranked: Array<{ index: number; score: number; reason: string }>;
          }>(
            `你是一个内容评分专家。请对以下${contents.length}条内容进行评分（1-10分）并排序。
评分标准：话题热度、内容深度、传播潜力、目标受众匹配度。

内容列表：
${contentList}

输出 JSON: { "ranked": [{ "index": 序号, "score": 分数, "reason": "评分理由" }] }
按分数从高到低排序。`,
            { temperature: 0.3 }
          );

          return {
            success: true,
            data: {
              ranked: result.ranked.map((r) => ({
                ...contents[r.index - 1],
                score: r.score,
                reason: r.reason,
              })),
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `内容分析失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },
  ];
}
