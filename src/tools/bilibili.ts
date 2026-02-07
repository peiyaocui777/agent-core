/**
 * B站工具集
 *
 * B站专栏文章 / 视频投稿 / 动态发布
 */

import type { Tool, AgentConfig } from "../types.js";

export function createBilibiliTools(config: AgentConfig = {}): Tool[] {
  const baseUrl = config.trendApiUrl || "http://localhost:18070";

  return [
    {
      name: "bilibili-publish-article",
      description: "发布 B 站专栏文章",
      category: "publish",
      parameters: {
        title: { type: "string", description: "文章标题（80字以内）", required: true },
        content: { type: "string", description: "正文内容（支持 Markdown）", required: true },
        tags: { type: "array", description: "标签列表（最多12个）", required: false },
        category: { type: "string", description: "分类（科技/生活/知识等）", required: false },
        coverUrl: { type: "string", description: "封面图 URL", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/bilibili/article`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `B站文章发布失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "bilibili-publish-dynamic",
      description: "发布 B 站动态（图文/纯文字）",
      category: "publish",
      parameters: {
        content: { type: "string", description: "动态内容", required: true },
        images: { type: "array", description: "配图列表", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/bilibili/dynamic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `B站动态发布失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "bilibili-trending",
      description: "获取 B 站热门排行榜",
      category: "workflow",
      parameters: {
        type: { type: "string", description: "排行类型（all/tech/life/knowledge）", required: false },
        count: { type: "number", description: "获取数量", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/bilibili/trending?type=${params.type || "all"}&count=${params.count || 20}`);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `B站热门获取失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
  ];
}
