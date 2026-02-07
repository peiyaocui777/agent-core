/**
 * 微博工具集
 *
 * 发微博 / 获取热搜 / 话题管理
 */

import type { Tool, AgentConfig } from "../types.js";

export function createWeiboTools(config: AgentConfig = {}): Tool[] {
  const baseUrl = config.trendApiUrl || "http://localhost:18070";

  return [
    {
      name: "weibo-publish",
      description: "发布微博（文字+图片）",
      category: "publish",
      parameters: {
        content: { type: "string", description: "微博正文（2000字以内）", required: true },
        images: { type: "array", description: "配图列表（最多9张）", required: false },
        topics: { type: "array", description: "话题列表（如 #AI副业#）", required: false },
        visible: { type: "string", description: "可见性（public/friends/private）", required: false },
      },
      execute: async (params) => {
        try {
          // 自动添加话题 # 号
          if (params.topics) {
            params.topics = (params.topics as string[]).map((t: string) =>
              t.startsWith("#") ? t : `#${t}#`
            );
          }
          const res = await fetch(`${baseUrl}/api/weibo/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `微博发布失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "weibo-hot-search",
      description: "获取微博热搜榜",
      category: "workflow",
      parameters: {
        count: { type: "number", description: "获取数量", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/weibo/hot-search?count=${params.count || 50}`);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `微博热搜获取失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "weibo-repost",
      description: "转发微博",
      category: "publish",
      parameters: {
        weiboId: { type: "string", description: "要转发的微博 ID", required: true },
        comment: { type: "string", description: "转发评论", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/weibo/repost`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `微博转发失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
  ];
}
