/**
 * 知乎工具集
 *
 * 知乎文章/回答/想法发布 + 热榜获取
 */

import type { Tool, AgentConfig } from "../types.js";

export function createZhihuTools(config: AgentConfig = {}): Tool[] {
  const baseUrl = config.trendApiUrl || "http://localhost:18070";

  return [
    {
      name: "zhihu-publish-article",
      description: "发布知乎专栏文章",
      category: "publish",
      parameters: {
        title: { type: "string", description: "文章标题（100字以内）", required: true },
        content: { type: "string", description: "正文内容（支持 Markdown）", required: true },
        topics: { type: "array", description: "关联话题（最多5个）", required: false },
        column: { type: "string", description: "专栏名称", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/zhihu/article`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `知乎文章发布失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "zhihu-answer-question",
      description: "回答知乎问题",
      category: "publish",
      parameters: {
        questionId: { type: "string", description: "问题 ID", required: true },
        content: { type: "string", description: "回答内容", required: true },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/zhihu/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `知乎回答失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "zhihu-hot-list",
      description: "获取知乎热榜",
      category: "workflow",
      parameters: {
        count: { type: "number", description: "获取数量", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/zhihu/hot-list?count=${params.count || 50}`);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `知乎热榜获取失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "zhihu-search-questions",
      description: "搜索知乎问题（寻找高关注待回答问题）",
      category: "workflow",
      parameters: {
        keyword: { type: "string", description: "搜索关键词", required: true },
        sort: { type: "string", description: "排序（relevance/newest/popular）", required: false },
        count: { type: "number", description: "获取数量", required: false },
      },
      execute: async (params) => {
        try {
          const url = `${baseUrl}/api/zhihu/search?keyword=${encodeURIComponent(params.keyword as string)}&sort=${params.sort || "relevance"}&count=${params.count || 20}`;
          const res = await fetch(url);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `知乎搜索失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
  ];
}
